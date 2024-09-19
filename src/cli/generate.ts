import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { snakeToCamel, sql } from 'pg-nano'
import type { GenerateContext, Plugin, PluginContext } from 'pg-nano/plugin'
import { camel, mapify, pascal, select } from 'radashi'
import type { Env } from './env'
import { quoteName, SQLIdentifier, unsafelyQuotedName } from './identifier.js'
import { introspectBaseTypes, introspectNamespaces } from './introspect'
import { jsTypesByOid } from './jsTypesByOid.js'
import { log } from './log'
import { parseMigrationPlan } from './parseMigrationPlan'
import {
  isBaseType,
  isCompositeType,
  isEnumType,
  isTableType,
  PgIdentityKind,
  PgObjectType,
  PgParamKind,
  type PgBaseType,
  type PgCompositeType,
  type PgEnumType,
  type PgField,
  type PgFieldContext,
  type PgObject,
  type PgTable,
  type PgTableField,
  type PgType,
} from './pgTypes.js'
import { prepareDatabase } from './prepare'
import { dedent } from './util/dedent'
import { cwdRelative } from './util/path.js'

export type GenerateOptions = {
  signal?: AbortSignal
}

export async function generate(
  env: Env,
  filePaths: string[],
  options: GenerateOptions = {},
) {
  const pg = await env.client
  const baseTypes = await introspectBaseTypes(pg, options.signal)

  const [allObjects, pluginsByStatementId] = await prepareDatabase(
    filePaths,
    baseTypes,
    env,
  )

  const routineStmts = mapify(
    allObjects.filter(obj => obj.kind === 'routine'),
    obj => obj.id.toQualifiedName(),
  )

  log('Migrating database...')

  await migrate(env)

  log('Generating type definitions...')

  // Step 1: Collect type information from the database.
  const namespaces = await introspectNamespaces(pg, options.signal)

  const typesByOid = new Map<number, PgType>()
  const typesByName = new Map<string, PgType>()

  const registerType = (
    object: PgBaseType | PgEnumType | PgCompositeType | PgTable,
    isArray: boolean,
    jsType?: string,
  ) => {
    const oid = isArray ? object.arrayOid : object.oid
    const suffix = isArray ? '[]' : ''
    const type: PgType = {
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

  type GeneratePlugin = Plugin & { generateStart: Function }

  const generatePlugins = env.config.plugins.filter(
    (p): p is GeneratePlugin => p.generateStart != null,
  )

  // Step 3: Run the `generateStart` hook for each plugin.
  for (const plugin of generatePlugins) {
    await plugin.generateStart(generateContext, env.config)
  }

  const moduleBasename = path.basename(env.config.generate.outFile) + '.js'
  const builtinTypeRegex = /\b(Interval|Range|Circle|Point|Timestamp|JSON)\b/
  const renderedObjects = new Map<PgObject, string>()
  const renderedCompositeFields = new Map<number, string>()
  const renderedEnumTypes = new Map<number, string>()
  const renderedBaseTypes = new Map<number, string>()
  const unsupportedTypes = new Set<number>()
  const foreignImports = new Set<string>()
  const imports = new Set<string>()

  const formatFieldName = (name: string) =>
    env.config.generate.fieldCase === 'camel'
      ? unsafelyQuotedName(snakeToCamel(name), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')
      : unsafelyQuotedName(name)

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
            const jsType = renderTypeReference(
              field.typeOid,
              type,
              null,
              null,
              field.name,
              field,
            )

            const optionalToken = field.hasNotNull ? '' : '?'

            return `${jsName}${optionalToken}: ${jsType}`
          })
          .join('\n')}
      }\n\n
    `

  const renderTableType = (table: PgTable) =>
    dedent`
      export type ${pascal(table.name)} = {
        ${table.fields
          .map(field => {
            const jsName = formatFieldName(field.name)
            const jsType = renderTypeReference(
              field.typeOid,
              table,
              PgParamKind.Out,
              null,
              field.name,
              field,
            )

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
              const jsType = renderTypeReference(
                field.typeOid,
                table,
                PgParamKind.In,
                null,
                field.name,
                field,
              )

              const optionalToken =
                field.hasNotNull && !field.hasDefault ? '' : '?'

              return `${jsName}${optionalToken}: ${jsType}`
            })
            .join('\n')}
        }
      }\n\n
    `

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
    let code: string

    const type = typesByOid.get(oid)
    if (!type) {
      code = oid + ' /* unknown */'
    } else if (isBaseType(type)) {
      const baseType = type.object
      const typeName = baseType.name + (type.isArray ? '_array' : '')

      if (!renderedBaseTypes.has(oid)) {
        renderedBaseTypes.set(oid, `export const ${typeName} = ${oid}`)
      }

      code = 't.' + typeName
    } else if (isEnumType(type)) {
      const enumType = type.object
      const enumName =
        (enumType.schema !== 'public' ? `${enumType.schema}.` : '') +
        enumType.name

      if (!renderedEnumTypes.has(oid)) {
        renderedEnumTypes.set(oid, `export const ${enumName} = ${oid}`)
      }

      code = oid + ` /* ${enumName} */`
    } else {
      code = 't.' + type.object.name
    }

    for (const plugin of fieldMapperPlugins) {
      const fieldMapper = plugin.mapField(
        {
          ...generateContext,
          ...fieldContext,
          fieldType: type ?? typesByName.get('unknown')!,
        },
        env.config,
      )
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

      code = 't.' + fieldMapper.name + '(' + code + ')'
      break
    }

    return code
  }

  const renderFields = (
    fields: ({
      name: string
      typeOid: number
      paramKind?: PgParamKind
      paramIndex?: number
    } | null)[],
    context: Omit<PgFieldContext, 'fieldName' | 'fieldType'>,
    compact?: boolean,
  ) =>
    `{${compact ? ' ' : '\n  '}${select(fields, field => {
      if (!field) {
        return null
      }

      const name = formatFieldName(field.name)
      const type = renderFieldType(field.typeOid, {
        fieldName: field.name,
        paramKind: field.paramKind,
        paramIndex: field.paramIndex,
        ...context,
      })

      return `${name}: ${type}`
    }).join(compact ? ', ' : ',\n  ')}${compact ? ' ' : '\n'}}`

  const renderCompositeFields = (object: PgCompositeType | PgTable) =>
    dedent`
      export const ${object.name} = ${renderFields(object.fields, { container: object })} as const
    `

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
    paramKind?: PgParamKind | null,
    paramIndex?: number | null,
    fieldName?: string,
    field?: PgField | PgTableField,
    skipPlugins?: boolean,
  ) => {
    let type = typesByOid.get(oid)

    if (!skipPlugins && typeReferencePlugins.length > 0) {
      const pluginContext: PluginContext['mapTypeReference'] = {
        ...generateContext,
        type: type ?? typesByName.get('unknown')!,
        container,
        field,
        fieldName,
        paramKind,
        paramIndex,
        renderTypeReference: (oid, newParamKind = paramKind) =>
          renderTypeReference(
            oid,
            container,
            newParamKind,
            paramIndex,
            fieldName,
            field,
            true,
          ),
      }

      for (const plugin of typeReferencePlugins) {
        const result = plugin.mapTypeReference(pluginContext, env.config)
        if (result) {
          if (result.lang === 'ts') {
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
            renderedCompositeFields.set(
              type.object.oid,
              renderCompositeFields(type.object),
            )
          }
        }
        if (type.object.schema !== container.schema) {
          jsType = addSchemaPrefix(
            type.object.name,
            type.object.schema,
            container.schema,
          )
          if (type.isArray) {
            jsType += '[]'
          }
        }
        if (isTableType(type) && paramKind === PgParamKind.In) {
          jsType = jsType.replace(/(?=\[)|$/, '.InsertParams')
        }
      }
    } else {
      jsType = 'unknown'
      unsupportedTypes.add(oid)
    }

    return jsType
  }

  const types = Array.from(typesByName.values())

  // Step 4: Render type definitions for each function. This also builds up a
  // list of dependencies (e.g. imports and type definitions).
  for (const nsp of Object.values(namespaces)) {
    for (const routine of nsp.routines) {
      const jsName = camel(routine.name)

      const jsArgNames = routine.paramNames
        ?.slice(0, routine.paramTypes.length)
        .map(name => name.replace(/^p_/, ''))

      const jsArgTypes = routine.paramTypes.map((typeOid, index) =>
        renderTypeReference(
          typeOid,
          routine,
          routine.paramKinds?.[index] ?? PgParamKind.In,
          index,
          jsArgNames?.[index] ?? `$${index + 1}`,
        ),
      )

      const jsNamedParams = jsArgNames?.map((name, index) => {
        const optionalToken =
          index >= routine.paramTypes.length - routine.numDefaultParams
            ? '?'
            : ''

        return `${formatFieldName(name)}${optionalToken}: ${jsArgTypes[index]}`
      })

      /** When true, a row type is returned (either a set or a single row). */
      let returnsRow = false

      /** TypeScript type for the function's return value. */
      let jsResultType: string | undefined

      /** Runtime parsing hints for result fields. */
      let resultFields: string | undefined

      // Find the function's CREATE statement, which contains metadata that is
      // useful for type generation.
      const id = new SQLIdentifier(routine.name, routine.schema)
      const stmt = routineStmts.get(id.toQualifiedName())!

      if (!stmt.returnType) {
        jsResultType = 'void'
      } else if (stmt.returnType instanceof SQLIdentifier) {
        jsResultType = renderTypeReference(
          routine.returnTypeOid,
          routine,
          PgParamKind.Out,
        )

        const type = typesByOid.get(routine.returnTypeOid)
        if (type && type.object.type !== PgObjectType.Base) {
          if (isTableType(type) && !type.isArray) {
            returnsRow = true
          }

          // Determine if any of the table fields are composite types. If so, we
          // need to generate runtime parsing hints for them.
          if (type.object.type !== PgObjectType.Enum) {
            const rowFields = type.object.fields.map(field => {
              const fieldType = typesByOid.get(field.typeOid)
              return fieldType && 'fields' in fieldType.object ? field : null
            })

            if (rowFields.some(Boolean)) {
              resultFields = renderFields(
                rowFields,
                {
                  container: routine,
                  paramKind: PgParamKind.Out,
                  rowType: type.object,
                },
                true,
              )
            }
          }
        }
      } else {
        const rowFields: (PgField | null)[] = []

        returnsRow = true
        jsResultType = `{ ${stmt.returnType
          .map((field, index) => {
            const type = types.find(
              type =>
                type.object.name === field.type.name &&
                type.object.schema === (field.type.schema ?? routine.schema),
            )

            rowFields[index] =
              type && 'fields' in type.object
                ? {
                    name: field.name,
                    typeOid: type.object.oid,
                    hasNotNull: false,
                  }
                : null

            const jsName = formatFieldName(field.name)
            const jsType = type
              ? renderTypeReference(
                  type.object.oid,
                  routine,
                  PgParamKind.Table,
                  null,
                  field.name,
                )
              : 'unknown'

            return `${jsName}: ${jsType}`
          })
          .join(', ')} }`

        if (rowFields.some(Boolean)) {
          resultFields = renderFields(
            rowFields,
            { container: routine, paramKind: PgParamKind.Table },
            true,
          )
        }
      }

      if (resultFields) {
        if (returnsRow && !routine.returnSet) {
          // When a function doesn't use SETOF, TABLE(), or a table identifier
          // in its RETURNS clause, the result is a single row with a single
          // column. That column's name is the function name, because we don't
          // give it an alias.
          resultFields = `{ ${unsafelyQuotedName(routine.name)}: ${resultFields} }`
        }
        resultFields = `, ${resultFields}`
      }

      const inParams = jsArgNames
        ? renderFields(
            jsArgNames.map((name, index) => ({
              name: name,
              typeOid: routine.paramTypes[index],
              paramKind: routine.paramKinds?.[index] ?? PgParamKind.In,
              paramIndex: index,
            })),
            { container: routine },
            true,
          )
        : `[${routine.paramTypes
            .map((typeOid, index) => {
              return renderFieldType(typeOid, {
                fieldName: `$${index + 1}`,
                container: routine,
                paramKind: routine.paramKinds?.[index] ?? PgParamKind.In,
                paramIndex: index,
              })
            })
            .join(', ')}]`

      const constructor = returnsRow
        ? routine.returnSet
          ? 'bindQueryRowList'
          : 'bindQueryRow'
        : routine.returnSet
          ? 'bindQueryValueList'
          : 'bindQueryValue'

      imports.add(constructor)

      const pgName =
        routine.schema !== 'public'
          ? `[${quoteName(routine.schema)}, ${quoteName(routine.name)}]`
          : quoteName(routine.name)

      const fnScript = dedent`
        export declare namespace ${jsName} {
          type Params = ${jsNamedParams ? `{ ${jsNamedParams.join(', ')} }` : `[${jsArgTypes.join(', ')}]`}
          type Result = ${jsResultType}
        }

        export const ${jsName} = /* @__PURE__ */ ${constructor}<${jsName}.Params, ${jsName}.Result>(${pgName}, ${inParams}${resultFields})\n\n
      `

      renderedObjects.set(routine, fnScript)
    }
  }

  const { outFile } = env.config.generate

  const renderedFieldMappers = Object.values(fieldMappers).map(
    fieldMapper => `export { ${fieldMapper.name} } from "${fieldMapper.path}"`,
  )

  // Step 5: Write the "typeData.ts" module.
  if (
    renderedBaseTypes.size +
    renderedEnumTypes.size +
    renderedCompositeFields.size +
    renderedFieldMappers.length
  ) {
    foreignImports.add("* as t from './typeData.js'")
    fs.writeFileSync(
      path.resolve(outFile, '../typeData.ts'),
      "import * as t from './typeData.js'\n\n// Base types\n" +
        Array.from(renderedBaseTypes.values()).sort().join('\n') +
        (renderedFieldMappers.length > 0
          ? '\n\n// Field mappers\n' + renderedFieldMappers.join('\n')
          : '') +
        (renderedEnumTypes.size > 0
          ? '\n\n// Enum types\n' +
            Array.from(renderedEnumTypes.values()).sort().join('\n')
          : '') +
        (renderedCompositeFields.size > 0
          ? '\n\n// Composite types\n' +
            Array.from(renderedCompositeFields.values()).join('\n\n')
          : '') +
        '\n',
    )
  }

  let code = dedent`
    import { ${[...imports].sort().join(', ')} } from 'pg-nano'\n
  `

  for (const foreignImport of foreignImports) {
    code += `import ${foreignImport}\n`
  }

  code += '\n'

  const nameSort = (a: { name: string }, b: { name: string }) =>
    a.name.localeCompare(b.name)

  // Step 6: Concatenate type definitions for each namespace.
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

  // Step 7: Write the TypeScript schema to a file.
  fs.writeFileSync(outFile, code.replace(/\s+$/, '\n'))

  // Step 8: Warn about any unsupported types.
  for (const typeOid of unsupportedTypes) {
    const typeName = await pg.queryValue<string>(sql`
      SELECT typname FROM pg_type WHERE oid = ${sql.val(typeOid)}
    `)

    log.warn(`Unsupported type: ${typeName} (${typeOid})`)
  }

  // log.eraseLine()
  log.success('Generating type definitions... done')
}

async function migrate(env: Env) {
  const applyProc = pgSchemaDiff(env, 'apply')

  let applyStderr = ''
  applyProc.stderr?.on('data', data => {
    applyStderr += data
  })

  if (env.verbose) {
    const successRegex = /(No plan generated|Finished executing)/
    const commentRegex = /^\s+-- /

    let completed = false
    for await (const line of parseMigrationPlan(applyProc.stdout)) {
      if (line.type === 'title') {
        if (line.text === 'Complete') {
          completed = true
        } else {
          log(line.text)
        }
      } else if (line.type === 'body') {
        if (completed || successRegex.test(line.text)) {
          log.success(line.text)
        } else if (commentRegex.test(line.text)) {
          log.comment(line.text)
        } else {
          log.command(line.text)
        }
      }
    }
  }

  await new Promise((resolve, reject) => {
    applyProc.on('close', resolve)
    applyProc.on('error', reject)
  })

  if (applyStderr) {
    let message = applyStderr

    const schemaDirRegex = new RegExp(env.schemaDir + '/[^)]+')
    if (env.verbose) {
      message = message.replace(schemaDirRegex, source => {
        const [, file, line] = fs
          .readFileSync(source, 'utf8')
          .match(/file:\/\/(.+?)#L(\d+)/)!

        return `${cwdRelative(file)}:${line}`
      })
    } else {
      const source = applyStderr.match(schemaDirRegex)
      const pgError = applyStderr.match(/\bERROR: ([\S\s]+)$/)?.[1]
      if (pgError) {
        message = pgError.trimEnd()
      }
      if (source) {
        const [, file, line] =
          fs.readFileSync(source[0], 'utf8').match(/file:\/\/(.+?)#L(\d+)/) ||
          []

        if (file && line) {
          message += `\n\n    at ${cwdRelative(file)}:${line}`
        }
      }
    }
    throw new Error(message)
  }
}

function pgSchemaDiff(env: Env, command: 'apply' | 'plan') {
  const applyArgs: string[] = []
  if (command === 'apply') {
    // const prePlanFile = path.join(env.untrackedDir, 'pre-plan.sql')
    // fs.writeFileSync(prePlanFile, 'SET check_function_bodies = off;')

    applyArgs.push(
      '--skip-confirm-prompt',
      '--allow-hazards',
      env.config.migration.allowHazards.join(','),
      '--disable-plan-validation',
      // '--pre-plan-file',
      // prePlanFile,
    )
  }

  const binaryPath = path.join(
    new URL(import.meta.resolve('@pg-nano/pg-schema-diff/package.json'))
      .pathname,
    '../pg-schema-diff',
  )

  return spawn(binaryPath, [
    command,
    '--dsn',
    env.config.dev.connectionString,
    '--schema-dir',
    env.schemaDir,
    ...applyArgs,
  ])
}

function indent(text: string, count = 2) {
  return text.replace(/^/gm, ' '.repeat(count))
}
