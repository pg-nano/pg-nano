import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { sql } from 'pg-nano'
import { camel, mapify, pascal } from 'radashi'
import type { Env } from './env'
import { quoteName, SQLIdentifier, unsafelyQuotedName } from './identifier.js'
import {
  introspectNamespaces,
  type PgCompositeType,
  type PgEnumType,
  type PgObject,
  type PgTable,
} from './introspect'
import { log } from './log'
import { parseMigrationPlan } from './parseMigrationPlan'
import type { PgColumnDef } from './parseObjectStatements.js'
import { prepareDatabase } from './prepare'
import {
  typeConversion,
  typeMappings,
  type PgTypeMapping,
} from './typeConversion'
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

  const allObjects = await prepareDatabase(filePaths, env)

  const allFunctionsByName = mapify(
    allObjects.filter(obj => obj.kind === 'function'),
    obj => obj.id.toQualifiedName(),
  )

  log('Migrating database...')

  await migrate(env)

  log('Generating type definitions...')

  // Step 1: Collect type information from the database.
  const namespaces = await introspectNamespaces(pg, options.signal)

  type PgUserType = {
    arity: 'unit' | 'array'
    mapping: PgTypeMapping
  } & (
    | { kind: 'enum'; object: PgEnumType }
    | { kind: 'composite'; object: PgCompositeType }
    | { kind: 'table'; object: PgTable }
  )

  const userTypes = new Map<number, PgUserType>()

  const extendedTypeMappings = [...typeMappings]
  const extendedTypeConversion = { ...typeConversion }

  // Step 2: Add types to the type conversion map.
  for (const nsp of Object.values(namespaces)) {
    const registerTypeMapping = (
      typeOid: number,
      typeName: string,
      typeSuffix = '',
    ) => {
      const mapping: PgTypeMapping = {
        oid: typeOid,
        name: typeName + typeSuffix,
        jsType: pascal(typeName) + typeSuffix,
        schema: nsp.name,
      }
      extendedTypeConversion[typeOid] = typeName + typeSuffix
      extendedTypeMappings.push(mapping)
      return mapping
    }

    for (const [kind, types] of [
      ['enum', nsp.enumTypes],
      ['composite', nsp.compositeTypes],
      ['table', nsp.tables],
    ] as const) {
      for (const type of types) {
        userTypes.set(type.oid, {
          kind,
          arity: 'unit',
          object: type,
          mapping: registerTypeMapping(type.oid, type.typname),
        })
        userTypes.set(type.typarray, {
          kind,
          arity: 'array',
          object: type,
          mapping: registerTypeMapping(type.typarray, type.typname, '[]'),
        })
      }
    }
  }

  // Step 3: Run the `generate` hook for each plugin.
  for (const plugin of env.config.plugins) {
    if (plugin.generate) {
      await plugin.generate({
        types: extendedTypeMappings,
        namespaces,
      })
    }
  }

  const moduleBasename = path.basename(env.config.generate.outFile) + '.js'
  const builtinTypeRegex = /\b(Interval|Range|Circle|Point|JSON)\b/
  const renderedObjects = new Map<PgObject, string>()
  const renderedTupleDefs = new Map<PgObject, string>()
  const unsupportedTypes = new Set<number>()
  const imports = new Set<string>()

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
            return `${attr.attname}${attr.attnotnull ? '' : '?'}: ${renderTypeReference(attr.atttypid, type.nspname, 'type')}`
          })
          .join('\n')}
      }\n\n
    `

  const renderTableType = (type: PgTable) =>
    dedent`
      export type ${pascal(type.typname)} = {
        ${type.attributes
          .map(attr => {
            return `${attr.attname}${attr.attnotnull ? '' : '?'}: ${renderTypeReference(attr.atttypid, type.nspname, 'return')}`
          })
          .join('\n')}
      }
      export declare namespace ${pascal(type.typname)} {
        type InsertParams = {
          ${type.attributes
            .filter(attr => attr.attidentity !== 'a')
            .map(attr => {
              return `${attr.attname}${attr.attnotnull && !attr.atthasdef ? '' : '?'}: ${renderTypeReference(attr.atttypid, type.nspname, 'param')}`
            })
            .join('\n')}
        }
      }\n\n
    `

  const renderTupleDef = (type: PgCompositeType | PgTable) =>
    dedent`
      export const ${pascal(type.typname)} = [${type.attributes
        .map(attr => {
          const userType = userTypes.get(attr.atttypid)
          return userType && userType.kind !== 'enum'
            ? `{ ${unsafelyQuotedName(attr.attname)}: ${pascal(userType.object.typname)} }`
            : quoteName(attr.attname)
        })
        .join(', ')}]\n\n
    `

  type TypeReferenceKind = 'return' | 'param' | 'type'

  /**
   * Render a reference to a type, given a type OID and the current namespace
   * context.
   */
  const renderTypeReference = (
    typeOid: number,
    context: string,
    kind: TypeReferenceKind,
  ) => {
    let type = extendedTypeConversion[typeOid]
    if (type) {
      const userType = userTypes.get(typeOid)
      if (userType) {
        const object = userType.object
        if (!renderedObjects.has(object)) {
          if (userType.kind === 'enum') {
            renderedObjects.set(object, renderEnumType(object as PgEnumType))
          } else {
            // Prevent issue with circular references.
            renderedObjects.set(object, '')
            renderedObjects.set(
              object,
              userType.kind === 'composite'
                ? renderCompositeType(userType.object)
                : renderTableType(userType.object),
            )

            // Prevent issue with circular references.
            renderedTupleDefs.set(object, '')
            renderedTupleDefs.set(object, renderTupleDef(userType.object))
          }
        }
        if (object.nspname !== context) {
          type = addNamespacePrefix(object.typname, object.nspname, context)
          if (userType.arity === 'array') {
            type += '[]'
          }
        } else {
          type = userType.mapping.jsType
        }
        if (userType.kind === 'table' && kind === 'param') {
          type = type.replace(/(?=\[)|$/, '.InsertParams')
        }
      } else {
        const match = type.match(builtinTypeRegex)
        if (match) {
          imports.add('type ' + match[1])
        }
      }
    } else {
      type = 'unknown'
      unsupportedTypes.add(typeOid)
    }
    return type
  }

  // Step 4: Render type definitions for each function. This also builds up a
  // list of dependencies (e.g. imports and type definitions).
  for (const nsp of Object.values(namespaces)) {
    for (const fn of nsp.functions) {
      const jsName = camel(fn.proname)

      const argNames = fn.proargnames?.map(name =>
        camel(name.replace(/^p_/, '')),
      )
      const argTypes = fn.proargtypes
        .map((typeOid, index, argTypes) => {
          if (argNames) {
            const jsName = argNames[index]
            const optionalToken =
              index >= argTypes.length - fn.pronargdefaults ? '?' : ''

            return `${jsName}${optionalToken}: ${renderTypeReference(typeOid, fn.nspname, 'param')}`
          }
          return renderTypeReference(typeOid, fn.nspname, 'param')
        })
        .join(', ')

      const schema =
        fn.nspname !== 'public' ? `, ${JSON.stringify(fn.nspname)}` : ''

      const params =
        argNames || schema ? `, ${JSON.stringify(argNames || null)}` : ''

      let resultType: string | undefined
      let resultKind: 'row' | 'value' | undefined

      const fnStmt = allFunctionsByName.get(fn.nspname + '.' + fn.proname)!

      if (!fnStmt.returnType) {
        resultType = 'void'
      } else if (fnStmt.returnType instanceof SQLIdentifier) {
        resultType = renderTypeReference(fn.prorettype, fn.nspname, 'return')

        const userType = userTypes.get(fn.prorettype)
        if (userType?.kind === 'table' && userType.arity === 'unit') {
          resultKind = 'row'
        }
      } else {
        const renderColumn = (col: PgColumnDef) => {
          const mapping = extendedTypeMappings.find(
            mapping =>
              mapping.name === col.type.name &&
              mapping.schema === (col.type.schema ?? fn.nspname),
          )
          return `${col.name}: ${mapping ? renderTypeReference(mapping.oid, fn.nspname, 'return') : 'unknown'}`
        }

        resultType = `{ ${fnStmt.returnType.map(renderColumn).join(', ')} }`
        resultKind = 'row'
      }

      const constructor =
        resultKind === 'row'
          ? fn.proretset
            ? 'routineQueryAll'
            : 'routineQueryOne'
          : fn.proretset
            ? 'routineQueryAllValues'
            : 'routineQueryOneValue'

      imports.add(constructor)

      const fnScript = dedent`
        export declare namespace ${jsName} {
          type Params = ${argNames ? `{ ${argTypes} }` : `[${argTypes}]`}
          type Result = ${resultType}
        }

        export const ${jsName} = /* @__PURE__ */ ${constructor}<${jsName}.Params, ${jsName}.Result>(${JSON.stringify(fn.proname)}${params}${schema})\n\n
      `

      renderedObjects.set(fn, fnScript)
    }
  }

  let code = dedent`
    import { ${[...imports].sort().join(', ')} } from 'pg-nano'\n\n
  `

  // Step 5: Concatenate type definitions for each namespace.
  for (const nsp of Object.values(namespaces)) {
    let nspCode = ''

    for (const tupleDef of renderedTupleDefs.values()) {
      nspCode += tupleDef
    }

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

  // Step 6: Write the generated type definitions to a file.
  fs.writeFileSync(env.config.generate.outFile, code.replace(/\s+$/, '\n'))

  // Step 7: Warn about any unsupported types.
  for (const typeOid of unsupportedTypes) {
    const typeName = await pg.queryOneValue<string>(sql`
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
        const [, file, line] = fs
          .readFileSync(source[0], 'utf8')
          .match(/file:\/\/(.+?)#L(\d+)/)!

        message += `\n\n    at ${cwdRelative(file)}:${line}`
      }
    }
    throw new Error(message)
  }
}

function pgSchemaDiff(env: Env, command: 'apply' | 'plan') {
  const applyArgs: string[] = []
  if (command === 'apply') {
    const prePlanFile = path.join(env.untrackedDir, 'pre-plan.sql')
    fs.writeFileSync(prePlanFile, 'SET check_function_bodies = off;')

    applyArgs.push(
      '--skip-confirm-prompt',
      '--allow-hazards',
      env.config.migration.allowHazards.join(','),
      '--disable-plan-validation',
      '--pre-plan-file',
      prePlanFile,
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
