import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { ShallowOptions } from 'option-types'
import { snakeToCamel, sql } from 'pg-nano'
import type { RoutineBindingContext } from 'pg-nano/config'
import { camel, map, mapify, pascal, select, shake, sift } from 'radashi'
import stringArgv from 'string-argv'
import type {
  GenerateContext,
  Plugin,
  PluginContext,
} from '../config/plugin.js'
import { traceParser, traceRender } from '../debug.js'
import type { Env } from '../env.js'
import { events } from '../events.js'
import { renderJsonType } from '../inspector/infer/json.js'
import {
  inspectBaseTypes,
  inspectNamespaces,
  inspectViewFields,
} from '../inspector/inspect.js'
import {
  isBaseType,
  isCompositeType,
  isEnumType,
  isTableType,
  isViewType,
  type PgBaseType,
  type PgCompositeType,
  type PgEnumType,
  type PgField,
  type PgFieldContext,
  PgIdentityKind,
  type PgObject,
  PgObjectType,
  PgParamKind,
  type PgRoutine,
  type PgTable,
  type PgTableField,
  type PgType,
  type PgTypeReference,
  type PgView,
} from '../inspector/types.js'
import { quoteName, SQLIdentifier } from '../parser/identifier.js'
import { parseSQLStatements } from '../parser/parse.js'
import { dedent } from '../util/dedent.js'
import { memoAsync } from '../util/memoAsync.js'
import { migrateSchema } from './migrate/migrateSchema.js'
import { migrateStaticRows } from './migrate/migrateStaticRows.js'
import { prepareDatabase } from './prepare.js'
import { jsTypeByPgName, subtypeByPgName } from './typeMappings.js'

export type GenerateOptions = {
  signal?: AbortSignal
  /**
   * When true, no files are emitted, but the database is still migrated.
   */
  noEmit?: boolean
  /**
   * Called right before pg-schema-diff is invoked.
   */
  preMigrate?: () => any
  /**
   * Override the default file-reading API.
   *
   * @default import('node:fs').readFileSync
   */
  readFile?: (filePath: string, encoding: BufferEncoding) => string
}

export async function generate(
  env: Env,
  filePaths: string[],
  options: GenerateOptions = {},
) {
  const pg = await env.client
  const baseTypes = await inspectBaseTypes(pg, options.signal)

  // Include our internal SQL files in the migration plan.
  filePaths.push(new URL(import.meta.resolve('pg-nano/sql/nano.sql')).pathname)

  const readFile = options.readFile ?? fs.readFileSync

  const { objectStmts, insertStmts } = flatMapProperties(
    await map(filePaths, async file => {
      traceParser('parsing schema file:', file)
      return await parseSQLStatements(readFile(file, 'utf8'), file, baseTypes)
    }),
  )

  events.emit('parser:found', { objectStmts, insertStmts })

  const { pluginsByStatementId, droppedTables, sortedObjectStmts } =
    await prepareDatabase(objectStmts, insertStmts, baseTypes, env)

  if (options.preMigrate) {
    await options.preMigrate()
  }

  await migrateSchema(env, droppedTables)
  await migrateStaticRows(pg, insertStmts, objectStmts, droppedTables)

  if (options.noEmit) {
    return
  }

  const tableStmts = mapify(
    objectStmts.filter(obj => obj.kind === 'table'),
    obj => obj.id.toQualifiedName(),
  )

  const routineStmts = mapify(
    objectStmts.filter(obj => obj.kind === 'routine'),
    obj => obj.id.toQualifiedName(),
  )

  events.emit('generate:start')

  // Step 1: Collect type information from the database.
  const namespaces = await inspectNamespaces(pg, options.signal)

  /** Objects found in the database by introspection. */
  const objects: PgObject[] = []

  const typesByOid = new Map<number, Required<PgTypeReference>>()
  const typesByName = new Map<string, Required<PgTypeReference>>()

  const getTypeName = (name: string, schema: string, isArray?: boolean) => {
    return (
      (schema !== 'public' && schema !== 'pg_catalog'
        ? schema + '.' + name
        : name) + (isArray ? '[]' : '')
    )
  }

  const registerType = (
    object: PgBaseType | PgEnumType | PgCompositeType | PgTable | PgView,
    isArray: boolean,
    jsType?: string,
  ) => {
    const oid = isArray ? object.arrayOid : object.oid
    const type: Required<PgTypeReference> = {
      // The first type assertion provides a bit of type safety, while the any
      // assertion is necessary for assignability.
      object: object as PgTypeReference['object'] as any,
      jsType: jsType ?? pascal(object.name),
      isArray,
    }
    typesByOid.set(oid, type)
    typesByName.set(getTypeName(object.name, object.schema, isArray), type)
  }

  for (const baseType of baseTypes) {
    const jsType = jsTypeByPgName[baseType.name] ?? 'string'
    registerType(baseType, false, jsType)
    if (baseType.arrayOid) {
      registerType(baseType, true, jsType)
    }
  }

  // Step 2: Register types and associate objects with plugins.
  for (const nsp of Object.values(namespaces)) {
    for (const types of [
      nsp.enumTypes,
      nsp.compositeTypes,
      nsp.tables,
      nsp.views,
    ] as const) {
      for (const type of types) {
        registerType(type, false)
        if (type.arrayOid) {
          registerType(type, true)
        }
        const id = new SQLIdentifier(type.name, type.schema)
        type.plugin = pluginsByStatementId.get(id.toQualifiedName())
        objects.push(type)
      }
    }
    for (const routine of nsp.routines) {
      const id = new SQLIdentifier(routine.name, routine.schema)
      routine.plugin = pluginsByStatementId.get(id.toQualifiedName())
      objects.push(routine)
    }
  }

  const getViewFields = memoAsync((view: PgView) => {
    return inspectViewFields(pg, view, objects, options.signal)
  })

  const generateContext: GenerateContext = Object.freeze({
    typesByName,
    typesByOid,
    namespaces,
    routines: Object.values(namespaces).flatMap(nsp => nsp.routines),
    tables: Object.values(namespaces).flatMap(nsp => nsp.tables),
  })

  type GenerateStartPlugin = Plugin & { generateStart: Function }

  const generateStartPlugins = env.config.plugins.filter(
    (p): p is GenerateStartPlugin => p.generateStart != null,
  )

  // Step 3: Run the `generateStart` hook for each plugin.
  for (const plugin of generateStartPlugins) {
    await plugin.generateStart(generateContext, env.config)
  }

  const {
    outFile,
    fieldCase,
    preferredExtension,
    applyFunctionPatterns,
    postGenerateScript,
  } = env.config.generate

  const renderedObjects = new Map<PgObject, string>()
  const renderedRowMappers = new Map<PgObject, string>()

  const moduleBasename = path.basename(outFile) + '.' + preferredExtension
  const builtinTypeRegex = /\b(Interval|Range|Circle|Point|Timestamp|JSON)\b/
  const referencedObjects = new Set<PgObject>()
  const unsupportedTypes = new Set<number>()
  const foreignImports = new Set<string>()
  const imports = new Set<string>()

  const formatFieldName = (name: string) => {
    if (fieldCase === 'camel') {
      name = snakeToCamel(name)
    }
    if (/\W/.test(name)) {
      return JSON.stringify(name)
    }
    return name
  }

  const addSchemaPrefix = (name: string, schema: string, context: string) => {
    let prefix: string
    if (schema === 'public' && namespaces[context].names.includes(name)) {
      // When a type in the current namespace conflicts with a type in the
      // public namespace, we need to import the public type (rather than use
      // `public.foo`), because types in the public namespace are not actually
      // wrapped with `namespace` syntax.
      prefix = `import('./${moduleBasename}')`
    } else {
      prefix = pascal(schema)
    }
    return prefix + '.' + pascal(name)
  }

  const renderEnumType = (type: PgEnumType) =>
    dedent`
      export type ${pascal(type.name)} = ${type.labels
        .map(label => {
          return JSON.stringify(label)
        })
        .join(' | ')}\n\n
    `

  const renderCompositeType = (type: PgCompositeType) =>
    dedent`
      export type ${pascal(type.name)} = {
        ${type.fields
          .map(field => {
            const jsName = formatFieldName(field.name)
            const jsType = renderTypeReference(field.typeOid, type, {
              fieldName: field.name,
              field,
            })

            const optionalToken = field.nullable ? '?' : ''

            return `${jsName}${optionalToken}: ${jsType}`
          })
          .join('\n')}
      }\n\n
    `

  const renderViewType = async (view: PgView) => {
    const fields = await getViewFields(view)
    const renderedFields = fields.map(field => {
      const jsName = formatFieldName(field.name)
      const jsType = field.jsonType
        ? renderJsonType(field.jsonType)
        : renderTypeReference(field.typeOid, view, {
            fieldName: field.name,
            field,
          })

      const optionalToken = field.nullable ? '?' : ''

      return `${jsName}${optionalToken}: ${jsType}`
    })

    return dedent`
      export type ${pascal(view.name)} = {
        ${renderedFields.join('\n')}
      }\n\n
    `
  }

  const renderTableFields =
    (table: PgTable, paramKind: PgParamKind) => (field: PgTableField) => {
      const jsFieldName = formatFieldName(field.name)
      const jsFieldType = renderTypeReference(field.typeOid, table, {
        paramKind,
        fieldName: field.name,
        field,
      })

      const optionalToken = field.nullable ? '?' : ''

      return `${jsFieldName}${optionalToken}: ${jsFieldType}`
    }

  const renderTableType = (table: PgTable) => {
    const tableId = new SQLIdentifier(table.name, table.schema)
    const tableStmt = tableStmts.get(tableId.toQualifiedName())!
    imports.add('type Input')

    // Render the TypeScript types for a table's “at rest” shape.
    const fields = table.fields.map(renderTableFields(table, PgParamKind.Out))

    // Render the TypeScript types for a table's “insert” shape.
    const insertFields = select(
      table.fields,
      renderTableFields(table, PgParamKind.In),
      // Omit fields that are always generated by the database.
      field => field.identity !== PgIdentityKind.Always,
    )

    // Check if the table's “insert” shape differs from its “at rest” shape. If
    // they're the same, we can avoid repeating the field definitions.
    const insertDiffers =
      fields.length !== insertFields.length ||
      fields.some((def, index) => def !== insertFields[index])

    // Render the TypeScript types for a table's “upsert” shape.
    const upsertFields = select(tableStmt.primaryKeyColumns, fieldName => {
      const field = table.fields.find(f => f.name === fieldName)!

      // Since the upsert shape is merged with the insert shape, we only need to
      // render fields that are either (1) always generated by the database or
      // (2) have a default value.
      if (field.identity !== PgIdentityKind.Always && !field.hasDefault) {
        return
      }

      const jsFieldName = formatFieldName(fieldName)

      return `${jsFieldName}: ${renderTypeReference(field.typeOid, table, {
        paramKind: PgParamKind.In,
        fieldName: field.name,
        field,
      })}`
    })

    const jsTableName = pascal(table.name)

    return dedent`
      export type ${jsTableName} = {
        ${fields.join('\n')}
      }
      export declare namespace ${jsTableName} {
        type InsertParams = Input<${
          insertDiffers ? `{\n  ${insertFields.join('\n  ')}\n}` : jsTableName
        }>
        type UpsertParams = InsertParams${
          upsertFields.length > 0
            ? ` & Input<{\n  ${upsertFields.join('\n  ')}\n}>`
            : ''
        }
      }\n\n
    `
  }

  type FieldMapperPlugin = Plugin & { mapField: Function }

  const fieldMapperPlugins = env.config.plugins.filter(
    (p): p is FieldMapperPlugin => p.statements != null,
  )

  const fieldMappers: {
    [name: string]: { name: string; path: string }
  } = {}

  const renderFieldMapper = (
    oid: number,
    fieldContext: Omit<PgFieldContext, 'fieldType'>,
  ) => {
    let type = typesByOid.get(oid)

    if (fieldMapperPlugins.length > 0) {
      const mapFieldContext = {
        ...generateContext,
        ...fieldContext,
        fieldType: type ?? typesByName.get('unknown')!,
      }

      for (const plugin of fieldMapperPlugins) {
        const fieldMapper = plugin.mapField(mapFieldContext, env.config)
        if (!fieldMapper) {
          continue
        }

        if (
          fieldMapper.name in fieldMappers &&
          fieldMappers[fieldMapper.name].path !== fieldMapper.path
        ) {
          throw new Error(
            `Field mapper "${fieldMapper.name}" returned from plugin "${plugin.name}" has a conflicting path: ${fieldMappers[fieldMapper.name].path} !== ${fieldMapper.path}`,
          )
        }

        fieldMappers[fieldMapper.name] = fieldMapper

        return (
          't.' +
          fieldMapper.name +
          (fieldMapper.args ? `(${fieldMapper.args})` : '')
        )
      }
    }

    if (!type) {
      return ''
    }

    let jsFieldMapperId: string | undefined
    let isRange: boolean | undefined

    if (type.jsType.startsWith('Range<')) {
      isRange = true
      const subtypeName = subtypeByPgName[type.object.name]
      type = typesByName.get(subtypeName)!
    }

    if (isBaseType(type)) {
      const { paramKind } = fieldContext
      if (!paramKind || isInputParam(paramKind)) {
        if (type.jsType === 'Timestamp') {
          jsFieldMapperId = 't.timestamp'
        }
      }
    } else if (isCompositeType(type) || isTableType(type) || isViewType(type)) {
      jsFieldMapperId = 't.' + type.object.name
    }

    if (jsFieldMapperId) {
      if (isRange) {
        jsFieldMapperId = 't.range(' + jsFieldMapperId + ')'
      }
      const ndims = fieldContext.ndims ?? (type.isArray ? 1 : 0)
      for (let i = 0; i < ndims; i++) {
        jsFieldMapperId = 't.array(' + jsFieldMapperId + ')'
      }
    }

    return jsFieldMapperId ?? ''
  }

  const renderRowMapper = (
    object: PgCompositeType | PgTable | PgView,
    fields: PgField[] = object.fields!,
  ) => {
    const names = fields.map(field => field.name)
    const types = sift(
      fields.map(field => {
        const fieldMapper = renderFieldMapper(field.typeOid, {
          fieldName: field.name,
          ndims: field.ndims,
          container: object,
        })
        if (fieldMapper) {
          return ` ${formatFieldName(field.name)}: ${fieldMapper}`
        }
      }),
    )

    let args = JSON.stringify(names)
    if (types.length > 0) {
      args += `, {${types} }`
    }

    return dedent`
      export const ${object.name} = /* @__PURE__ */ t.row(${args})
    `
  }

  // Note: View types are not rendered by this function, because their column
  // types are lazily inferred, which means rendering them is asynchronous.
  const renderCustomType = (type: PgType) => {
    switch (type.type) {
      case PgObjectType.Enum: {
        renderedObjects.set(type, renderEnumType(type))
        break
      }
      case PgObjectType.Composite: {
        renderedObjects.set(type, renderCompositeType(type))
        renderedRowMappers.set(type, renderRowMapper(type))
        break
      }
      case PgObjectType.Table: {
        renderedObjects.set(type, renderTableType(type))
        renderedRowMappers.set(type, renderRowMapper(type))
        break
      }
    }
  }

  type TypeReferencePlugin = Plugin & { mapTypeReference: Function }

  const typeReferencePlugins = env.config.plugins.filter(
    (p): p is TypeReferencePlugin => p.mapTypeReference != null,
  )

  /**
   * Render a reference to a type, given a type OID and the current namespace
   * context.
   */
  const renderTypeReference = (
    oid: number,
    container: Exclude<PgObject, PgEnumType>,
    options?: ShallowOptions<{
      paramKind?: PgParamKind
      paramIndex?: number
      fieldName?: string
      field?: PgField | PgTableField
      ndims?: number
    }>,
    skipPlugins?: boolean,
  ) => {
    let type = typesByOid.get(oid)

    if (!skipPlugins && typeReferencePlugins.length > 0) {
      const pluginContext: PluginContext['mapTypeReference'] = {
        ...generateContext,
        type: type ?? typesByName.get('unknown')!,
        container,
        ...options,
        renderTypeReference: (oid, newParamKind) =>
          renderTypeReference(
            oid,
            container,
            {
              ...options,
              paramKind: newParamKind ?? options?.paramKind,
            },
            true,
          ),
      }

      for (const plugin of typeReferencePlugins) {
        const result = plugin.mapTypeReference(pluginContext, env.config)
        if (result) {
          if (result.lang === 'ts') {
            if (traceRender.enabled) {
              traceRender(
                'renderTypeReference',
                shake({
                  oid,
                  type,
                  jsType: result.type,
                  options,
                  plugin: plugin.name,
                }),
              )
            }
            return result.type
          }

          type = typesByName.get(result.type)

          if (!type) {
            throw new Error(
              `Unknown type "${result.type}" returned from plugin "${plugin.name}"`,
            )
          }
        }
      }
    }

    let jsType: string

    if (type) {
      jsType = type.jsType

      if (isBaseType(type)) {
        const match = jsType.match(builtinTypeRegex)
        if (match) {
          imports.add('type ' + match[1])
        }
      } else {
        if (!referencedObjects.has(type.object)) {
          referencedObjects.add(type.object)
          renderCustomType(type.object)
        }

        if (type.object.schema !== container.schema) {
          jsType = addSchemaPrefix(
            type.object.name,
            type.object.schema,
            container.schema,
          )
        }
        if (isTableType(type) && options?.paramKind === PgParamKind.In) {
          jsType += '.InsertParams'
        }
      }
    } else {
      jsType = 'unknown'
      unsupportedTypes.add(oid)
    }

    const ndims =
      options?.ndims ?? options?.field?.ndims ?? (type?.isArray ? 1 : 0)

    if (ndims > 0) {
      if (jsType.includes(' ')) {
        jsType = `(${jsType})`
      }
      jsType += '[]'.repeat(ndims)
    }

    if (traceRender.enabled && !skipPlugins) {
      traceRender(
        'renderTypeReference',
        shake({
          oid,
          type,
          jsType,
          options,
        }),
      )
    }

    return jsType
  }

  const types = Array.from(typesByName.values())

  const renderRoutine = async (routine: PgRoutine) => {
    const jsName = camel(routine.name)

    traceRender('renderRoutine', routine)

    const argNames = routine.paramNames
      ?.slice(0, routine.paramTypes.length)
      .map(name => name.replace(/^p_/, ''))

    const jsArgTypes = routine.paramTypes.map((typeOid, index) =>
      renderTypeReference(typeOid, routine, {
        paramKind: routine.paramKinds?.[index] ?? PgParamKind.In,
        paramIndex: index,
        fieldName: argNames?.[index] ?? `$${index + 1}`,
      }),
    )

    const jsArgEntries = argNames?.some(Boolean)
      ? argNames.map((name, index) => {
          const optionalToken =
            index >= routine.paramTypes.length - routine.numDefaultParams
              ? '?'
              : ''

          return `${name === '' ? '$' + (index + 1) : formatFieldName(name)}${optionalToken}: ${jsArgTypes[index]}`
        })
      : null

    /** When true, a row type is used in the return type, either with or without SETOF. */
    let returnRow = false

    /** TypeScript type for the function's return value. */
    let jsResultType: string | undefined

    /** Runtime parsing hints for result fields. */
    const outputMappers: [string, string][] = []

    // Find the function's CREATE statement, which contains metadata that is
    // useful for type generation.
    const id = new SQLIdentifier(routine.name, routine.schema)
    const stmt = routineStmts.get(id.toQualifiedName())!

    if (!stmt.returnType) {
      jsResultType = 'void'
    } else if (stmt.returnType instanceof SQLIdentifier) {
      jsResultType = renderTypeReference(routine.returnTypeOid, routine, {
        paramKind: PgParamKind.Out,
      })

      const type = typesByOid.get(routine.returnTypeOid)
      if (type && type.object.type !== PgObjectType.Base) {
        if ((isTableType(type) || isViewType(type)) && !type.isArray) {
          returnRow = true
        }

        // Determine if any of the table fields are composite types. If so, we
        // need to generate runtime parsing hints for them.
        if (!isEnumType(type)) {
          const fields = isViewType(type)
            ? await getViewFields(type.object)
            : type.object.fields

          fields.forEach(field => {
            const fieldType = typesByOid.get(field.typeOid)
            if (fieldType && 'fields' in fieldType.object) {
              const fieldMapper = renderFieldMapper(field.typeOid, {
                fieldName: field.name,
                ndims: field.ndims,
                container: routine,
                paramKind: PgParamKind.Out,
                rowType: fieldType.object,
              })
              if (fieldMapper) {
                outputMappers.push([field.name, fieldMapper])
              }
            }
          })
        }
      }
    } else {
      returnRow = true
      jsResultType = `{ ${stmt.returnType
        .map(field => {
          const fieldType = types.find(
            type =>
              type.object.name === field.type.name &&
              (type.object.type === PgObjectType.Base
                ? !field.type.schema || field.type.schema === 'pg_catalog'
                : type.object.schema === (field.type.schema ?? 'public')) &&
              type.isArray === !!field.type.arrayBounds,
          )

          if (fieldType && 'fields' in fieldType.object) {
            const fieldMapper = renderFieldMapper(fieldType.object.oid, {
              fieldName: field.name,
              ndims: field.type.arrayBounds?.length,
              container: routine,
              paramKind: PgParamKind.Table,
            })
            if (fieldMapper) {
              outputMappers.push([field.name, fieldMapper])
            }
          }

          const jsName = formatFieldName(field.name)
          const jsType = fieldType
            ? renderTypeReference(fieldType.object.oid, routine, {
                paramKind: PgParamKind.Table,
                fieldName: field.name,
                ndims: field.type.arrayBounds?.length,
              })
            : 'unknown'

          // Assume nullable until we can infer otherwise.
          return `${jsName}?: ${jsType}`
        })
        .join(', ')} }`
    }

    const minArgCount = routine.paramTypes.length - routine.numDefaultParams
    const maxArgCount = routine.paramTypes.length

    let builder = `$ => $.arity(${minArgCount}, ${maxArgCount})`
    if (argNames) {
      if (argNames.length) {
        builder += `.namedArgs(${JSON.stringify(argNames.map(formatFieldName))})`
      }
      argNames.forEach((name, index) => {
        const typeOid = routine.paramTypes[index]
        const fieldMapper = renderFieldMapper(typeOid, {
          fieldName: name,
          container: routine,
          paramKind: routine.paramKinds?.[index] ?? PgParamKind.In,
          paramIndex: index,
        })
        if (fieldMapper) {
          builder += `.mapInput(${index}, ${fieldMapper})`
        }
      })
    } else {
      routine.paramTypes.forEach((typeOid, index) => {
        const fieldMapper = renderFieldMapper(typeOid, {
          fieldName: `$${index + 1}`,
          container: routine,
          paramKind: routine.paramKinds?.[index] ?? PgParamKind.In,
          paramIndex: index,
        })
        if (fieldMapper) {
          builder += `.mapInput(${index}, ${fieldMapper})`
        }
      })
    }
    if (returnRow && !routine.returnSet) {
      builder += `.returnsRecord()`
    }
    if (outputMappers.length) {
      for (const [key, type] of outputMappers) {
        builder += `.mapOutput(${JSON.stringify(key)}, ${type})`
      }
    }

    const pgName =
      routine.schema !== 'public'
        ? `[${quoteName(routine.schema)}, ${quoteName(routine.name)}]`
        : quoteName(routine.name)

    const binding: RoutineBindingContext = {
      name: routine.name,
      bindingFunction:
        routine.bindingFunction ??
        (returnRow
          ? routine.returnSet
            ? 'bindQueryRowList'
            : 'bindQueryRowOrNull'
          : routine.returnSet
            ? 'bindQueryValueList'
            : 'bindQueryValue'),
    }

    applyFunctionPatterns?.(binding)
    imports.add(binding.bindingFunction)

    return dedent`
      export declare namespace ${jsName} {
        type Params = ${jsArgEntries ? `{ ${jsArgEntries.join(', ')} }` : `[${jsArgTypes.join(', ')}]`}
        type Result = ${jsResultType}
      }

      export const ${jsName} = /* @__PURE__ */ ${binding.bindingFunction}<${jsName}.Params, ${jsName}.Result>(${pgName}, ${builder})\n\n
    `
  }

  // Step 4: Render bindings for each Postgres routine. At the same time,
  // collect any referenced types to be imported or generated.
  for (const nsp of Object.values(namespaces)) {
    for (const routine of nsp.routines) {
      renderedObjects.set(routine, await renderRoutine(routine))
    }
  }

  // Step 5: Infer the column types of each view that's been referenced by a
  // routine (directly or indirectly), then render its type definition and row
  // mapper.
  for (const object of referencedObjects) {
    if (object.type === PgObjectType.View) {
      renderedObjects.set(object, await renderViewType(object))
      renderedRowMappers.set(
        object,
        renderRowMapper(object, await getViewFields(object)),
      )
    }
  }

  const renderedFieldMappers = Object.values(fieldMappers).map(
    fieldMapper => `export { ${fieldMapper.name} } from "${fieldMapper.path}"`,
  )

  // Step 6: Write the "typeData.ts" module.
  if (renderedRowMappers.size + renderedFieldMappers.length) {
    foreignImports.add(`* as t from './typeData.${preferredExtension}'`)

    let code = dedent`
      /* BEWARE: This file was generated by pg-nano. Any changes you make will be overwritten. */
      import * as t from './typeData.${preferredExtension}'

      export * from 'pg-nano/field-mappers'
    `

    if (renderedFieldMappers.length > 0) {
      code += '\n\n// Field mappers\n' + renderedFieldMappers.join('\n')
    }

    if (renderedRowMappers.size > 0) {
      code += '\n\n// Composite types\n'

      // By iterating the topologically sorted statements, we can ensure that
      // row mappers are defined in topological order.
      for (const objectStmt of sortedObjectStmts) {
        const id = objectStmt.id
        const typeName = getTypeName(id.name, id.schema ?? 'public')
        const type = typesByName.get(typeName)
        if (type) {
          const rowMapper = renderedRowMappers.get(type.object)
          if (rowMapper) {
            code += rowMapper + '\n\n'
          }
        }
      }
    }

    fs.writeFileSync(path.resolve(outFile, '../typeData.ts'), code + '\n')
  }

  type GenerateEndPlugin = Plugin & { generateEnd: Function }

  const generateEndPlugins = env.config.plugins.filter(
    (p): p is GenerateEndPlugin => p.generateEnd != null,
  )

  const prelude: string[] = []

  // Step 7: Run the "generateEnd" hook of each plugin.
  if (generateEndPlugins.length > 0) {
    const generateEndContext: PluginContext['generateEnd'] = {
      renderedObjects,
      imports,
      foreignImports,
      prelude,
    }

    for (const plugin of generateEndPlugins) {
      await plugin.generateEnd(generateEndContext, env.config)
    }
  }

  let code = dedent`
    /* BEWARE: This file was generated by pg-nano. Any changes you make will be overwritten. */
    import { ${[...imports].sort().join(', ')} } from 'pg-nano'\n
  `

  for (const foreignImport of foreignImports) {
    code += `import ${foreignImport}\n`
  }

  code += '\n'

  if (prelude.length > 0) {
    code += prelude.join('\n') + '\n\n'
  }

  const outDir = path.dirname(outFile)

  const nameSort = (a: { name: string }, b: { name: string }) =>
    a.name.localeCompare(b.name)

  // Step 8: Concatenate type definitions for each namespace.
  for (const nsp of Object.values(namespaces)) {
    let nspCode = ''

    let objects: PgObject[] = [
      ...nsp.enumTypes,
      ...nsp.compositeTypes,
      ...nsp.tables,
      ...nsp.views,
    ]

    objects.sort(nameSort)
    objects = objects.concat(nsp.routines.sort(nameSort))

    for (const object of objects) {
      if (renderedObjects.has(object)) {
        const stmt = objectStmts.find(
          stmt =>
            object.name === stmt.id.name &&
            object.schema === (stmt.id.schema ?? 'public'),
        )
        if (stmt) {
          let file = path.relative(outDir, stmt.file)
          if (!file.startsWith('..')) {
            file = './' + file
          }
          nspCode += `/**\n * [Source](${file})\n */\n`
        }
        nspCode += renderedObjects.get(object)!
      }
    }

    // Don't wrap type definitions for the public namespace, to improve
    // ergonomics.
    code +=
      nsp.schema === 'public'
        ? nspCode
        : `export namespace ${pascal(nsp.schema)} {\n${indent(nspCode)}\n}\n\n`
  }

  // Step 9: Write the TypeScript schema to a file.
  fs.writeFileSync(outFile, code.replace(/\s+$/, '\n'))

  events.emit('generate:end')

  // Step 10: Warn about any unsupported types.
  for (const typeOid of unsupportedTypes) {
    const typeName = await pg.queryValue<string>(sql`
      SELECT typname FROM pg_type WHERE oid = ${sql.val(typeOid)}
    `)

    events.emit('unsupported-type', { typeName, typeOid })
  }

  if (postGenerateScript) {
    const [command, ...argv] = stringArgv(postGenerateScript)
    const proc = spawn(command, argv, {
      cwd: env.root,
      stdio: 'inherit',
    })
    await new Promise((resolve, reject) => {
      proc.on('close', resolve)
      proc.on('error', reject)
    })
  }
}

function indent(text: string, count = 2) {
  return text.replace(/^/gm, ' '.repeat(count))
}

function isInputParam(paramKind: PgParamKind | undefined) {
  return !!(
    paramKind &&
    extract(paramKind, [
      PgParamKind.In,
      PgParamKind.InOut,
      PgParamKind.Variadic,
    ])
  )
}

type IfExists<T, U> = T extends never ? never : U

function extract<TInput, const TOutput>(
  input: TInput,
  outputs: TOutput[],
): Extract<TOutput, TInput> | IfExists<Exclude<TInput, TOutput>, undefined> {
  const index = outputs.indexOf(input as any)
  return (index === -1 ? undefined : outputs[index]) as any
}

function flatMapProperties<T extends Record<string, any[]>>(objects: T[]): T {
  const merged = {} as T
  for (const key in objects[0]) {
    merged[key] = objects.flatMap(obj => obj[key]) as any
  }
  return merged
}
