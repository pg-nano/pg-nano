import type { GenerateContext, Plugin } from '@pg-nano/plugin'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { snakeToCamel, sql } from 'pg-nano'
import { camel, mapify, pascal, select } from 'radashi'
import type { Env } from './env'
import { quoteName, SQLIdentifier, unsafelyQuotedName } from './identifier.js'
import {
  introspectBaseTypes,
  introspectNamespaces,
  PgParamKind,
  type PgAttribute,
  type PgBaseType,
  type PgCompositeType,
  type PgEnumType,
  type PgFieldContext,
  type PgObject,
  type PgTable,
  type PgType,
} from './introspect'
import { jsTypesByOid } from './jsTypesByOid.js'
import { log } from './log'
import { parseMigrationPlan } from './parseMigrationPlan'
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

  const [allObjects, pluginsByStatementId] = await prepareDatabase(
    filePaths,
    env,
  )

  const allFunctionsByName = mapify(
    allObjects.filter(obj => obj.kind === 'routine'),
    obj => obj.id.toQualifiedName(),
  )

  log('Migrating database...')

  await migrate(env)

  log('Generating type definitions...')

  // Step 1: Collect type information from the database.
  const namespaces = await introspectNamespaces(pg, options.signal)
  const baseTypes = await introspectBaseTypes(pg, options.signal)

  const typesByOid = new Map<number, PgType>()
  const typesByName = new Map<string, PgType>()

  const registerType = (
    kind: 'base' | 'enum' | 'composite' | 'table',
    object: PgBaseType | PgEnumType | PgCompositeType | PgTable,
    isArray: boolean,
    jsType?: string,
  ) => {
    const oid = isArray ? object.typarray : object.oid
    const suffix = isArray ? '[]' : ''
    const type: PgType = {
      kind: kind as any,
      object: object as any,
      jsType: (jsType ?? pascal(object.typname)) + suffix,
      isArray,
    }
    typesByOid.set(oid, type)
    typesByName.set(
      (object.nspname !== 'public' && object.nspname !== 'pg_catalog'
        ? object.nspname + '.' + object.typname
        : object.typname) + suffix,
      type,
    )
  }

  for (const baseType of baseTypes) {
    const jsType = jsTypesByOid[baseType.oid] ?? 'string'
    registerType('base', baseType, false, jsType)
    if (baseType.typarray) {
      registerType('base', baseType, true, jsType)
    }
  }

  // Step 2: Register types and associate objects with plugins.
  for (const nsp of Object.values(namespaces)) {
    for (const [kind, types] of [
      ['enum', nsp.enumTypes],
      ['composite', nsp.compositeTypes],
      ['table', nsp.tables],
    ] as const) {
      for (const type of types) {
        registerType(kind, type, false)
        if (type.typarray) {
          registerType(kind, type, true)
        }
        const id = new SQLIdentifier(type.typname, type.nspname)
        type.plugin = pluginsByStatementId.get(id.toQualifiedName())
      }
    }
    for (const fn of nsp.functions) {
      const id = new SQLIdentifier(fn.proname, fn.nspname)
      fn.plugin = pluginsByStatementId.get(id.toQualifiedName())
    }
  }

  type GeneratePlugin = Plugin & { generate: Function }

  // Step 3: Run the `generate` hook for each plugin.
  const generatePlugins = env.config.plugins.filter(
    (p): p is GeneratePlugin => p.generate != null,
  )

  if (generatePlugins.length > 0) {
    const generateContext: GenerateContext = {
      types: typesByName,
      namespaces,
      functions: Object.values(namespaces).flatMap(nsp => nsp.functions),
      tables: Object.values(namespaces).flatMap(nsp => nsp.tables),
    }

    for (const plugin of generatePlugins) {
      await plugin.generate(generateContext, env.config)
    }
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

  const addNamespacePrefix = (
    typname: string,
    nspname: string,
    context: string,
  ) => {
    if (nspname !== context) {
      let nspPrefix: string
      if (nspname === 'public' && namespaces[context].names.includes(typname)) {
        // When a type in the current namespace conflicts with a type in the
        // public namespace, we need to import the public type (rather than
        // use `public.foo`), because types in the public namespace are not
        // actually wrapped with `namespace` syntax.
        nspPrefix = `import('./${moduleBasename}')`
      } else {
        nspPrefix = pascal(nspname)
      }
      return nspPrefix + '.' + pascal(typname)
    }
    return pascal(typname)
  }

  const renderEnumType = (type: PgEnumType) =>
    dedent`
      export type ${pascal(type.typname)} = ${type.labels
        .map(label => {
          return JSON.stringify(label)
        })
        .join(' | ')}\n\n
    `

  const renderCompositeType = (type: PgCompositeType) =>
    dedent`
      export type ${pascal(type.typname)} = {
        ${type.attributes
          .map(attr => {
            return `${formatFieldName(attr.attname)}${attr.attnotnull ? '' : '?'}: ${renderTypeReference(attr.atttypid, type.nspname, 'type')}`
          })
          .join('\n')}
      }\n\n
    `

  const renderTableType = (type: PgTable) =>
    dedent`
      export type ${pascal(type.typname)} = {
        ${type.attributes
          .map(attr => {
            return `${formatFieldName(attr.attname)}${attr.attnotnull ? '' : '?'}: ${renderTypeReference(attr.atttypid, type.nspname, 'return')}`
          })
          .join('\n')}
      }
      export declare namespace ${pascal(type.typname)} {
        type InsertParams = {
          ${type.attributes
            .filter(attr => attr.attidentity !== 'a')
            .map(attr => {
              return `${formatFieldName(attr.attname)}${attr.attnotnull && !attr.atthasdef ? '' : '?'}: ${renderTypeReference(attr.atttypid, type.nspname, 'param')}`
            })
            .join('\n')}
        }
      }\n\n
    `

  type FieldMapperPlugin = Plugin & { mapField: Function }

  const fieldMapperPlugns = env.config.plugins.filter(
    (p): p is FieldMapperPlugin => p.statements != null,
  )

  const fieldMappers: {
    [name: string]: { name: string; path: string }
  } = {}

  const renderFieldType = (
    oid: number,
    context: Omit<PgFieldContext, 'type'>,
  ) => {
    let code: string

    const type = typesByOid.get(oid)
    if (!type) {
      code = oid + ' /* unknown */'
    } else if (type.kind === 'base') {
      const baseType = type.object
      const typeName = baseType.typname + (type.isArray ? '_array' : '')

      if (!renderedBaseTypes.has(oid)) {
        renderedBaseTypes.set(oid, `export const ${typeName} = ${oid}`)
      }

      code = 't.' + typeName
    } else if (type.kind === 'enum') {
      const enumType = type.object
      const enumName =
        (enumType.nspname !== 'public' ? `${enumType.nspname}.` : '') +
        enumType.typname

      if (!renderedEnumTypes.has(oid)) {
        renderedEnumTypes.set(oid, `export const ${enumName} = ${oid}`)
      }

      code = oid + ` /* ${enumName} */`
    } else {
      code = 't.' + type.object.typname
    }

    for (const plugin of fieldMapperPlugns) {
      const fieldMapper = plugin.mapField(
        {
          ...context,
          type: type ?? typesByName.get('unknown')!,
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
      attname: string
      atttypid: number
      attmode?: PgParamKind
      attindex?: number
    } | null)[],
    context: Omit<PgFieldContext, 'field' | 'type'>,
    compact?: boolean,
  ) =>
    `{${compact ? ' ' : '\n  '}${select(fields, field => {
      if (!field) {
        return null
      }

      const name = formatFieldName(field.attname)
      const type = renderFieldType(field.atttypid, {
        field: field.attname,
        paramKind: field.attmode,
        paramIndex: field.attindex,
        ...context,
      })

      return `${name}: ${type}`
    }).join(compact ? ', ' : ',\n  ')}${compact ? ' ' : '\n'}}`

  const renderCompositeFields = (object: PgCompositeType | PgTable) =>
    dedent`
      export const ${object.typname} = ${renderFields(object.attributes, { object })} as const
    `

  type TypeReferenceKind = 'return' | 'param' | 'type'

  /**
   * Render a reference to a type, given a type OID and the current namespace
   * context.
   */
  const renderTypeReference = (
    oid: number,
    context: string,
    refKind: TypeReferenceKind,
  ) => {
    let jsType: string

    const type = typesByOid.get(oid)
    if (type) {
      jsType = type.jsType

      if (type.kind === 'base') {
        const match = jsType.match(builtinTypeRegex)
        if (match) {
          imports.add('type ' + match[1])
        }
      } else {
        if (!renderedObjects.has(type.object)) {
          if (type.kind === 'enum') {
            renderedObjects.set(type.object, renderEnumType(type.object))
          } else {
            renderedObjects.set(
              type.object,
              type.kind === 'composite'
                ? renderCompositeType(type.object)
                : renderTableType(type.object),
            )
            renderedCompositeFields.set(
              type.object.oid,
              renderCompositeFields(type.object),
            )
          }
        }
        if (type.object.nspname !== context) {
          jsType = addNamespacePrefix(
            type.object.typname,
            type.object.nspname,
            context,
          )
          if (type.isArray) {
            jsType += '[]'
          }
        }
        if (type.kind === 'table' && refKind === 'param') {
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
    for (const fn of nsp.functions) {
      const jsName = camel(fn.proname)

      const argNames = fn.proargnames
        ?.slice(0, fn.proargtypes.length)
        .map(name => name.replace(/^p_/, ''))

      const argTypes = fn.proargtypes.map(typeOid =>
        renderTypeReference(typeOid, fn.nspname, 'param'),
      )

      const namedArgTypes = argNames?.map((name, index) => {
        const optionalToken =
          index >= fn.proargtypes.length - fn.pronargdefaults ? '?' : ''

        return `${formatFieldName(name)}${optionalToken}: ${argTypes[index]}`
      })

      let resultType: string | undefined
      let resultKind: 'row' | 'value' | undefined
      let outParams: string | undefined

      const fnStmt = allFunctionsByName.get(fn.nspname + '.' + fn.proname)!

      if (!fnStmt.returnType) {
        resultType = 'void'
      } else if (fnStmt.returnType instanceof SQLIdentifier) {
        resultType = renderTypeReference(fn.prorettype, fn.nspname, 'return')

        const type = typesByOid.get(fn.prorettype)
        if (type && type.kind !== 'base') {
          if (type.kind === 'table' && !type.isArray) {
            resultKind = 'row'
          }
          if (type.kind !== 'enum') {
            const compositeAttrs = type.object.attributes.map(attr => {
              const attrType = typesByOid.get(attr.atttypid)
              return attrType && 'attributes' in attrType.object ? attr : null
            })

            if (compositeAttrs.some(Boolean)) {
              outParams = renderFields(
                compositeAttrs,
                {
                  object: fn,
                  paramKind: PgParamKind.Out,
                  rowType: type.object,
                },
                true,
              )
            }
          }
        }
      } else {
        const compositeAttrs: (PgAttribute | null)[] = []

        resultKind = 'row'
        resultType = `{ ${fnStmt.returnType
          .map((col, index) => {
            const type = types.find(
              type =>
                type.object.typname === col.type.name &&
                type.object.nspname === (col.type.schema ?? fn.nspname),
            )

            compositeAttrs[index] =
              type && 'attributes' in type.object
                ? {
                    attname: col.name,
                    attnotnull: false,
                    atttypid: type.object.oid,
                  }
                : null

            const name = formatFieldName(col.name)
            const jsType = type
              ? renderTypeReference(type.object.oid, fn.nspname, 'return')
              : 'unknown'

            return `${name}: ${jsType}`
          })
          .join(', ')} }`

        if (compositeAttrs.some(Boolean)) {
          outParams = renderFields(
            compositeAttrs,
            { object: fn, paramKind: PgParamKind.Table },
            true,
          )
        }
      }

      if (outParams) {
        if (resultKind !== 'row' && !fn.proretset) {
          // When a function doesn't use SETOF or a table type in its RETURNS
          // clause, the result is a single row with a single column. That
          // column's name is the function name, because we don't give it an
          // alias.
          outParams = `{ ${unsafelyQuotedName(fn.proname)}: ${outParams} }`
        }
        outParams = `, ${outParams}`
      }

      const inParams = argNames
        ? renderFields(
            argNames.map((name, index) => ({
              attname: name,
              atttypid: fn.proargtypes[index],
              attmode: fn.proargmodes?.[index] ?? PgParamKind.In,
              attindex: index,
            })),
            { object: fn },
            true,
          )
        : `[${fn.proargtypes
            .map((typeOid, index) => {
              return renderFieldType(typeOid, {
                field: `$${index + 1}`,
                object: fn,
                paramKind: fn.proargmodes?.[index] ?? PgParamKind.In,
                paramIndex: index,
              })
            })
            .join(', ')}]`

      const constructor =
        resultKind === 'row'
          ? fn.proretset
            ? 'bindQueryRowList'
            : 'bindQueryRow'
          : fn.proretset
            ? 'bindQueryValueList'
            : 'bindQueryValue'

      imports.add(constructor)

      const pgName =
        fn.nspname !== 'public'
          ? `[${quoteName(fn.nspname)}, ${quoteName(fn.proname)}]`
          : quoteName(fn.proname)

      const fnScript = dedent`
        export declare namespace ${jsName} {
          type Params = ${namedArgTypes ? `{ ${namedArgTypes.join(', ')} }` : `[${argTypes.join(', ')}]`}
          type Result = ${resultType}
        }

        export const ${jsName} = /* @__PURE__ */ ${constructor}<${jsName}.Params, ${jsName}.Result>(${pgName}, ${inParams}${outParams})\n\n
      `

      renderedObjects.set(fn, fnScript)
    }
  }

  const { outFile } = env.config.generate

  const renderedFieldMappers = Object.values(fieldMappers).map(
    fieldMapper => `export { ${fieldMapper.name} } from "${fieldMapper.path}"`,
  )

  // Step 5: Write the "types.ts" module.
  if (
    renderedBaseTypes.size +
    renderedEnumTypes.size +
    renderedCompositeFields.size +
    renderedFieldMappers.length
  ) {
    foreignImports.add("* as t from './types.js'")
    fs.writeFileSync(
      path.resolve(outFile, '../types.ts'),
      "import * as t from './types.js'\n\n// Base types\n" +
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

  // Step 6: Concatenate type definitions for each namespace.
  for (const nsp of Object.values(namespaces)) {
    let nspCode = ''

    for (const type of [
      ...nsp.enumTypes,
      ...nsp.compositeTypes,
      ...nsp.tables,
      ...nsp.functions,
    ]) {
      if (renderedObjects.has(type)) {
        nspCode += renderedObjects.get(type)!
      }
    }

    // Don't wrap type definitions for the public namespace, to improve
    // ergonomics.
    code +=
      nsp.name === 'public'
        ? nspCode
        : `export namespace ${pascal(nsp.name)} {\n${indent(nspCode)}\n}\n\n`
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
