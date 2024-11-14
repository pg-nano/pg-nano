import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { snakeToCamel, sql } from 'pg-nano'
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
import { inspectBaseTypes, inspectNamespaces } from '../inspector/inspect.js'
import {
  isBaseType,
  isCompositeType,
  isEnumType,
  isTableType,
  type PgBaseType,
  type PgCompositeType,
  type PgEnumType,
  type PgField,
  type PgFieldContext,
  PgIdentityKind,
  type PgObject,
  PgObjectType,
  PgParamKind,
  type PgTable,
  type PgTableField,
  type PgType,
} from '../inspector/types.js'
import { quoteName, SQLIdentifier } from '../parser/identifier.js'
import { parseObjectStatements } from '../parser/parse.js'
import { dedent } from '../util/dedent.js'
import { jsTypesByOid } from './jsTypesByOid.js'
import { migrate } from './migrate.js'
import { prepareDatabase } from './prepare.js'

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

  const readFile = options.readFile ?? fs.readFileSync

  const allObjects = (
    await map(filePaths, async file => {
      traceParser('parsing schema file:', file)
      return await parseObjectStatements(
        readFile(file, 'utf8'),
        file,
        baseTypes,
      )
    })
  ).flat()

  const { pluginsByStatementId } = await prepareDatabase(
    allObjects,
    baseTypes,
    env,
  )

  if (options.preMigrate) {
    await options.preMigrate()
  }

  events.emit('migrate:start')

  await migrate(env)

  if (options.noEmit) {
    return
  }

  const tableStmts = mapify(
    allObjects.filter(obj => obj.kind === 'table'),
    obj => obj.id.toQualifiedName(),
  )

  const routineStmts = mapify(
    allObjects.filter(obj => obj.kind === 'routine'),
    obj => obj.id.toQualifiedName(),
  )

  events.emit('generate:start')

  // Step 1: Collect type information from the database.
  const namespaces = await inspectNamespaces(pg, options.signal)

  const typesByOid = new Map<number, Required<PgType>>()
  const typesByName = new Map<string, Required<PgType>>()

  const registerType = (
    object: PgBaseType | PgEnumType | PgCompositeType | PgTable,
    isArray: boolean,
    jsType?: string,
  ) => {
    const oid = isArray ? object.arrayOid : object.oid
    const suffix = isArray ? '[]' : ''
    const type: Required<PgType> = {
      object: object as any,
      jsType: (jsType ?? pascal(object.name)) + suffix,
      isArray,
    }
    typesByOid.set(oid, type)
    typesByName.set(
      (object.schema !== 'public' && object.schema !== 'pg_catalog'
        ? object.schema + '.' + object.name
        : object.name) + suffix,
      type,
    )
  }

  for (const baseType of baseTypes) {
    const jsType = jsTypesByOid[baseType.oid] ?? 'string'
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
    ] as const) {
      for (const type of types) {
        registerType(type, false)
        if (type.arrayOid) {
          registerType(type, true)
        }
        const id = new SQLIdentifier(type.name, type.schema)
        type.plugin = pluginsByStatementId.get(id.toQualifiedName())
      }
    }
    for (const routine of nsp.routines) {
      const id = new SQLIdentifier(routine.name, routine.schema)
      routine.plugin = pluginsByStatementId.get(id.toQualifiedName())
    }
  }

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

  const moduleBasename = path.basename(env.config.generate.outFile) + '.js'
  const builtinTypeRegex = /\b(Interval|Range|Circle|Point|Timestamp|JSON)\b/
  const renderedObjects = new Map<PgObject, string>()
  const renderedCompositeData = new Map<number, string>()
  const unsupportedTypes = new Set<number>()
  const foreignImports = new Set<string>()
  const imports = new Set<string>()

  const { fieldCase } = env.config.generate

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

            const optionalToken = field.hasNotNull ? '' : '?'

            return `${jsName}${optionalToken}: ${jsType}`
          })
          .join('\n')}
      }\n\n
    `

  const renderTableType = (table: PgTable) => {
    const tableId = new SQLIdentifier(table.name, table.schema)
    const tableStmt = tableStmts.get(tableId.toQualifiedName())!

    return dedent`
      export type ${pascal(table.name)} = {
        ${table.fields
          .map(field => {
            const jsName = formatFieldName(field.name)
            const jsType = renderTypeReference(field.typeOid, table, {
              paramKind: PgParamKind.Out,
              fieldName: field.name,
              field,
            })

            const optionalToken = field.hasNotNull ? '' : '?'

            return `${jsName}${optionalToken}: ${jsType}`
          })
          .join('\n')}
      }
      export declare namespace ${pascal(table.name)} {
        type InsertParams = {
          ${table.fields
            .filter(field => field.identity !== PgIdentityKind.Always)
            .map(field => {
              const jsName = formatFieldName(field.name)
              const jsType = renderTypeReference(field.typeOid, table, {
                paramKind: PgParamKind.In,
                fieldName: field.name,
                field,
              })

              const optionalToken =
                field.hasNotNull && !field.hasDefault ? '' : '?'

              return `${jsName}${optionalToken}: ${jsType}`
            })
            .join('\n')}
        }
        type UpsertParams = InsertParams & {
          ${
            select(tableStmt.primaryKeyColumns, fieldName => {
              const field = table.fields.find(f => f.name === fieldName)!
              if (
                field.identity !== PgIdentityKind.Always &&
                !field.hasDefault
              ) {
                return
              }

              const jsName = formatFieldName(fieldName)

              return `${jsName}: ${renderTypeReference(field.typeOid, table, {
                paramKind: PgParamKind.In,
                fieldName: field.name,
                field,
              })}`
            }).join('\n') || '/* Primary key is always required */'
          }
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

  const renderFieldType = (
    oid: number,
    fieldContext: Omit<PgFieldContext, 'fieldType'>,
  ) => {
    const type = typesByOid.get(oid)

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

    if (type && (isCompositeType(type) || isTableType(type))) {
      let jsTypeId = 't.' + type.object.name

      const ndims = fieldContext.ndims ?? (type.isArray ? 1 : 0)
      for (let i = 0; i < ndims; i++) {
        jsTypeId = 't.array(' + jsTypeId + ')'
      }

      return jsTypeId
    }
    return ''
  }

  const renderCompositeData = (object: PgCompositeType | PgTable) => {
    const names = object.fields.map(field => field.name)
    const types = sift(
      object.fields.map(field => {
        const type = renderFieldType(field.typeOid, {
          fieldName: field.name,
          ndims: field.ndims,
          container: object,
        })
        if (type) {
          return `${formatFieldName(field.name)}: ${type}`
        }
      }),
    )

    let args = JSON.stringify(names)
    if (types.length > 0) {
      args += `, {${types}}`
    }

    return dedent`
      export const ${object.name} = /* @__PURE__ */ t.row(${args})
    `
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
    options?: {
      paramKind?: PgParamKind
      paramIndex?: number
      fieldName?: string
      field?: PgField | PgTableField
      ndims?: number
    },
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

      // Let bigint input parameters accept plain numbers.
      if (
        options?.paramKind != null &&
        options.paramKind !== PgParamKind.Out &&
        options.paramKind !== PgParamKind.Table &&
        jsType === 'BigInt'
      ) {
        jsType += ' | number'
      }

      if (isBaseType(type)) {
        const match = jsType.match(builtinTypeRegex)
        if (match) {
          imports.add('type ' + match[1])
        }
      } else {
        if (!renderedObjects.has(type.object)) {
          if (isEnumType(type)) {
            renderedObjects.set(type.object, renderEnumType(type.object))
          } else {
            renderedObjects.set(
              type.object,
              isCompositeType(type)
                ? renderCompositeType(type.object)
                : renderTableType(type.object),
            )
            renderedCompositeData.set(
              type.object.oid,
              renderCompositeData(type.object),
            )
          }
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

  // Step 4: Render type definitions for each function. This also builds up a
  // list of dependencies (e.g. imports and type definitions).
  for (const nsp of Object.values(namespaces)) {
    for (const routine of nsp.routines) {
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
      let returnsRow = false

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
          if (isTableType(type) && !type.isArray) {
            returnsRow = true
          }

          // Determine if any of the table fields are composite types. If so, we
          // need to generate runtime parsing hints for them.
          if (type.object.type !== PgObjectType.Enum) {
            type.object.fields.forEach(field => {
              const fieldType = typesByOid.get(field.typeOid)
              if (fieldType && 'fields' in fieldType.object) {
                const type = renderFieldType(field.typeOid, {
                  fieldName: field.name,
                  ndims: field.ndims,
                  container: routine,
                  paramKind: PgParamKind.Out,
                  rowType: fieldType.object,
                })
                if (type) {
                  outputMappers.push([field.name, type])
                }
              }
            })
          }
        }
      } else {
        returnsRow = true
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
              const type = renderFieldType(fieldType.object.oid, {
                fieldName: field.name,
                ndims: field.type.arrayBounds?.length,
                container: routine,
                paramKind: PgParamKind.Table,
              })
              if (type) {
                outputMappers.push([field.name, type])
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

            return `${jsName}: ${jsType}`
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
          const type = renderFieldType(typeOid, {
            fieldName: name,
            container: routine,
            paramKind: routine.paramKinds?.[index] ?? PgParamKind.In,
            paramIndex: index,
          })
          if (type) {
            builder += `.mapInput(${index}, ${type})`
          }
        })
      } else {
        routine.paramTypes.forEach((typeOid, index) => {
          const type = renderFieldType(typeOid, {
            fieldName: `$${index + 1}`,
            container: routine,
            paramKind: routine.paramKinds?.[index] ?? PgParamKind.In,
            paramIndex: index,
          })
          if (type) {
            builder += `.mapInput(${index}, ${type})`
          }
        })
      }
      if (returnsRow && !routine.returnSet) {
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

      const bindingFunction =
        routine.bindingFunction ??
        env.config.generate.functionPatterns?.(routine.name) ??
        (returnsRow
          ? routine.returnSet
            ? 'bindQueryRowList'
            : 'bindQueryRowOrNull'
          : routine.returnSet
            ? 'bindQueryValueList'
            : 'bindQueryValue')

      imports.add(bindingFunction)

      const routineScript = dedent`
        export declare namespace ${jsName} {
          type Params = ${jsArgEntries ? `{ ${jsArgEntries.join(', ')} }` : `[${jsArgTypes.join(', ')}]`}
          type Result = ${jsResultType}
        }

        export const ${jsName} = /* @__PURE__ */ ${bindingFunction}<${jsName}.Params, ${jsName}.Result>(${pgName}, ${builder})\n\n
      `

      renderedObjects.set(routine, routineScript)
    }
  }

  const { outFile } = env.config.generate

  const renderedFieldMappers = Object.values(fieldMappers).map(
    fieldMapper => `export { ${fieldMapper.name} } from "${fieldMapper.path}"`,
  )

  // Step 5: Write the "typeData.ts" module.
  if (renderedCompositeData.size + renderedFieldMappers.length) {
    foreignImports.add("* as t from './typeData.js'")
    const prelude = dedent`
      /* BEWARE: This file was generated by pg-nano. Any changes you make will be overwritten. */
      import * as t from './typeData.js'

      export { defineArrayMapper as array, defineRowMapper as row } from 'pg-nano'
    `
    fs.writeFileSync(
      path.resolve(outFile, '../typeData.ts'),
      prelude +
        (renderedFieldMappers.length > 0
          ? '\n\n// Field mappers\n' + renderedFieldMappers.join('\n')
          : '') +
        (renderedCompositeData.size > 0
          ? '\n\n// Composite types\n' +
            Array.from(renderedCompositeData.values()).join('\n\n')
          : '') +
        '\n',
    )
  }

  type GenerateEndPlugin = Plugin & { generateEnd: Function }

  const generateEndPlugins = env.config.plugins.filter(
    (p): p is GenerateEndPlugin => p.generateEnd != null,
  )

  const prelude: string[] = []

  // Step 6: Run the "generateEnd" hook of each plugin.
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

  const nameSort = (a: { name: string }, b: { name: string }) =>
    a.name.localeCompare(b.name)

  // Step 7: Concatenate type definitions for each namespace.
  for (const nsp of Object.values(namespaces)) {
    let nspCode = ''

    for (const type of [
      ...nsp.enumTypes.sort(nameSort),
      ...nsp.compositeTypes.sort(nameSort),
      ...nsp.tables.sort(nameSort),
      ...nsp.routines.sort(nameSort),
    ]) {
      if (renderedObjects.has(type)) {
        nspCode += renderedObjects.get(type)!
      }
    }

    // Don't wrap type definitions for the public namespace, to improve
    // ergonomics.
    code +=
      nsp.schema === 'public'
        ? nspCode
        : `export namespace ${pascal(nsp.schema)} {\n${indent(nspCode)}\n}\n\n`
  }

  // Step 8: Write the TypeScript schema to a file.
  fs.writeFileSync(outFile, code.replace(/\s+$/, '\n'))

  events.emit('generate:end')

  // Step 9: Warn about any unsupported types.
  for (const typeOid of unsupportedTypes) {
    const typeName = await pg.queryValue<string>(sql`
      SELECT typname FROM pg_type WHERE oid = ${sql.val(typeOid)}
    `)

    events.emit('unsupported-type', { typeName, typeOid })
  }

  if (env.config.generate.postGenerateScript) {
    const [command, ...argv] = stringArgv(
      env.config.generate.postGenerateScript,
    )
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
