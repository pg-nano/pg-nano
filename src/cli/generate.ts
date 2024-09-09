import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { Client, sql, type SQLTemplate } from 'pg-nano'
import { camel, mapify, pascal } from 'radashi'
import type { Env } from './env'
import {
  introspectNamespaces,
  type PgCompositeType,
  type PgEnumType,
  type PgObject,
} from './introspect'
import { log } from './log'
import { SQLIdentifier } from './parseIdentifier.js'
import { parseMigrationPlan } from './parseMigrationPlan'
import { prepareForMigration } from './prepare'
import {
  type PgTypeMapping,
  typeConversion,
  typeMappings,
} from './typeConversion'
import { dedent } from './util/dedent'

export type GenerateOptions = {
  refreshPluginRole?: boolean
  signal?: AbortSignal
}

export async function generate(
  env: Env,
  filePaths: string[],
  options: GenerateOptions = {},
) {
  const client = await env.client

  const allObjects = await prepareForMigration(filePaths, env)
  const allFunctionsByName = mapify(
    allObjects.filter(obj => obj.type === 'function'),
    obj => obj.id.toQualifiedName(),
  )

  log('Migrating database...')
  await migrate(env)

  if (await generatePluginQueries(env, options)) {
    return
  }

  log('Generating type definitions...')

  // Step 1: Collect type information from the database.
  const namespaces = await introspectNamespaces(client, options.signal)

  type PgUserType = {
    kind: 'enum' | 'composite'
    arity: 'unit' | 'array'
    meta: PgEnumType | PgCompositeType
    mapping: PgTypeMapping
  }

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
    ] as const) {
      for (const type of types) {
        userTypes.set(type.oid, {
          kind,
          arity: 'unit',
          meta: type,
          mapping: registerTypeMapping(type.oid, type.typname),
        })
        userTypes.set(type.typarray, {
          kind,
          arity: 'array',
          meta: type,
          mapping: registerTypeMapping(type.typarray, type.typname, '[]'),
        })
      }
    }
  }

  const moduleBasename = path.basename(env.config.typescript.outFile) + '.js'
  const builtinTypeRegex = /\b(Interval|Range|Circle|Point|JSON)\b/
  const renderedObjects = new Map<PgObject, string>()
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

  /**
   * Render a reference to a type, given a type OID and the current namespace
   * context.
   */
  const renderTypeReference = (typeOid: number, context: string) => {
    let type = extendedTypeConversion[typeOid]
    if (type) {
      const userType = userTypes.get(typeOid)
      if (userType) {
        const object = userType.meta
        if (!renderedObjects.has(object)) {
          if (userType.kind === 'enum') {
            renderedObjects.set(object, renderEnumType(object as PgEnumType))
          } else if (userType.kind === 'composite') {
            // First set an empty string to avoid infinite recursion if there
            // happens to be a circular reference.
            renderedObjects.set(object, '')
            renderedObjects.set(
              object,
              renderCompositeType(object as PgCompositeType),
            )
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

  // Step 3: Run the `generate` hook for each plugin.
  for (const plugin of env.config.plugins) {
    if (plugin.generate) {
      await plugin.generate({
        types: extendedTypeMappings,
        namespaces,
      })
    }
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

            return `${jsName}${optionalToken}: ${renderTypeReference(typeOid, fn.nspname)}`
          }
          return renderTypeReference(typeOid, fn.nspname)
        })
        .join(', ')

      const schema =
        fn.nspname !== 'public' ? `, ${JSON.stringify(fn.nspname)}` : ''

      const params =
        argNames || schema ? `, ${JSON.stringify(argNames || null)}` : ''

      let resultType: string | undefined
      let resultColumns: string[] | undefined
      let resultCompositeType: PgCompositeType | undefined

      const fnStmt = allFunctionsByName.get(fn.nspname + '.' + fn.proname)!

      if (fnStmt.returnType instanceof SQLIdentifier) {
        resultType = renderTypeReference(fn.prorettype, fn.nspname)

        const userType = userTypes.get(fn.prorettype)
        if (userType && 'fields' in userType.meta) {
          resultCompositeType = userType.meta as PgCompositeType
        }
      } else {
        resultColumns = fnStmt.returnType.map(col => {
          const mapping = extendedTypeMappings.find(
            mapping =>
              mapping.name === col.type.name &&
              mapping.schema === col.type.schema!,
          )
          return `${col.name}: ${mapping ? renderTypeReference(mapping.oid, fn.nspname) : 'unknown'}`
        })
      }

      const constructor = fn.proretset
        ? resultCompositeType || resultColumns
          ? 'queryRowsRoutine'
          : 'queryColumnsRoutine'
        : resultCompositeType || resultColumns
          ? 'queryOneRowRoutine'
          : 'queryOneColumnRoutine'

      imports.add(constructor)

      if (resultColumns) {
        resultType = `{ ${resultColumns.join(', ')} }`
      }

      if (fn.proretset) {
        resultType += '[]'
      }

      const fnScript = dedent`
        export declare namespace ${jsName} {
          export type Params = ${argNames ? `{${argTypes}}` : `[${argTypes}]`}
          export type Result = ${resultType}
        }

        export const ${jsName} = ${constructor}<${jsName}.Params, ${jsName}.Result>(${JSON.stringify(fn.proname)}${params}${schema})\n\n
      `

      renderedObjects.set(fn, fnScript)
    }
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
      export interface ${pascal(type.typname)} {
        ${type.fields
          .map(field => {
            return `${field.attname}${field.attnotnull ? '' : '?'}: ${renderTypeReference(field.atttypid, type.nspname)}`
          })
          .join('\n')}
      }\n\n
    `

  let code = dedent`
    import { ${[...imports].sort().join(', ')} } from 'pg-nano'
  `

  // Step 5: Concatenate type definitions for each namespace.
  for (const nsp of Object.values(namespaces)) {
    let nspCode = ''

    for (const type of nsp.enumTypes) {
      if (renderedObjects.has(type)) {
        nspCode += renderedObjects.get(type)!
      }
    }

    for (const type of nsp.compositeTypes) {
      if (renderedObjects.has(type)) {
        nspCode += renderedObjects.get(type)!
      }
    }

    for (const fn of nsp.functions) {
      nspCode += renderedObjects.get(fn)!
    }

    // Don't wrap type definitions for the public namespace, to improve
    // ergonomics.
    code +=
      nsp.name === 'public'
        ? nspCode
        : `export namespace ${pascal(nsp.name)} {\n${indent(nspCode)}\n}`
  }

  // Step 6: Write the generated type definitions to a file.
  fs.writeFileSync(env.config.typescript.outFile, code.replace(/\s+$/, '\n'))

  // Step 7: Warn about any unsupported types.
  for (const typeOid of unsupportedTypes) {
    const typeName = await client.queryOneColumn<string>(sql`
      SELECT typname FROM pg_type WHERE oid = ${sql.val(typeOid)}
    `)

    log.warn(`Unsupported type: ${typeName} (${typeOid})`)
  }

  // log.eraseLine()
  log.success('Generating type definitions... done')
}

async function migrate(env: Env) {
  const applyProc = diffSchemas(env, 'apply')

  let applyStderr = ''
  applyProc.stderr?.on('data', data => {
    applyStderr += data
  })

  if (env.config.verbose) {
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
    throw new Error(applyStderr)
  }
}

function diffSchemas(env: Env, command: 'apply' | 'plan') {
  const applyArgs: string[] = []
  if (command === 'apply') {
    applyArgs.push(
      '--skip-confirm-prompt',
      '--allow-hazards',
      env.config.migration.allowHazards.join(','),
      '--pre-plan-file',
      path.join(env.untrackedDir, 'pre-plan.sql'),
      '--disable-plan-validation',
    )
  }

  const pgSchemaDiff = path.join(
    new URL(import.meta.resolve('@pg-nano/pg-schema-diff/package.json'))
      .pathname,
    '../pg-schema-diff',
  )

  return spawn(pgSchemaDiff, [
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

async function generatePluginQueries(env: Env, options: GenerateOptions) {
  if (!env.config.plugins.some(p => p.queries)) {
    return false
  }

  log('Running plugins...')

  const pluginDsn = new URL(env.config.dev.connectionString)
  pluginDsn.username = 'nano_plugin'
  pluginDsn.password = 'postgres'

  let onExistingRole: SQLTemplate
  if (options.refreshPluginRole) {
    onExistingRole = sql`
      REVOKE ALL ON DATABASE ${sql.id(pluginDsn.pathname.slice(1))} FROM nano_plugin;

      REVOKE ALL ON SCHEMA public FROM nano_plugin;
      REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM nano_plugin;

      REVOKE ALL ON SCHEMA information_schema FROM nano_plugin;
      REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA information_schema FROM nano_plugin;

      REVOKE ALL ON SCHEMA pg_catalog FROM nano_plugin;
      REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA pg_catalog FROM nano_plugin;

      DROP ROLE IF EXISTS nano_plugin;
    `
  } else {
    onExistingRole = sql`RETURN;`
  }

  const client = await env.client
  await client.query(sql`
    DO $$ 
    BEGIN
      IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'nano_plugin') THEN
        ${onExistingRole}
      END IF;

      CREATE ROLE nano_plugin WITH LOGIN PASSWORD ${sql.val(pluginDsn.password)} NOINHERIT;

      GRANT CONNECT ON DATABASE ${sql.id(pluginDsn.pathname.slice(1))} TO nano_plugin;
      GRANT SELECT ON ALL TABLES IN SCHEMA information_schema TO nano_plugin;
      GRANT SELECT ON ALL TABLES IN SCHEMA pg_catalog TO nano_plugin;
      GRANT SELECT ON ALL TABLES IN SCHEMA public TO nano_plugin;
      GRANT USAGE ON SCHEMA information_schema TO nano_plugin;
      GRANT USAGE ON SCHEMA pg_catalog TO nano_plugin;
      GRANT USAGE ON SCHEMA public TO nano_plugin;
    END
    $$;
  `)

  const pluginClient = new Client()
  await pluginClient.connect(pluginDsn.toString())

  const pluginSqlFiles: { file: string; content: string }[] = []

  for (const plugin of env.config.plugins) {
    if (plugin.queries) {
      const template = await plugin.queries({
        client: pluginClient,
        sql,
      })
      if (template) {
        const outFile = path.join(
          env.config.typescript.pluginSqlDir,
          plugin.name.replace(/\//g, '__') + '.pgsql',
        )

        let oldContent = ''
        try {
          oldContent = fs.readFileSync(outFile, 'utf8')
        } catch (error: any) {
          if (error.code !== 'ENOENT') {
            throw error
          }
        }

        const content = dedent(await pluginClient.stringify(template))
        if (content !== oldContent) {
          pluginSqlFiles.push({
            file: outFile,
            content,
          })
        }
      }
    }
  }

  const count = pluginSqlFiles.length
  if (count > 0) {
    log(`Writing ${count} plugin SQL file${count === 1 ? '' : 's'}`)

    // Clear out any old plugin-generated SQL files.
    fs.rmSync(env.config.typescript.pluginSqlDir, {
      recursive: true,
      force: true,
    })

    fs.mkdirSync(env.config.typescript.pluginSqlDir, { recursive: true })
    for (const { file, content } of pluginSqlFiles) {
      fs.writeFileSync(file, content)
    }
  } else {
    log.success('Plugin-generated SQL is up to date')
  }

  return count > 0
}
