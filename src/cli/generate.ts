import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { Client, sql } from 'pg-nano'
import { camel, pascal } from 'radashi'
import type { Env } from './env'
import {
  introspectNamespaces,
  introspectResultSet,
  type PgCompositeType,
  type PgEnumType,
  type PgObject,
} from './introspect'
import { log } from './log'
import { parseMigrationPlan } from './parseMigrationPlan'
import { prepareForMigration } from './prepare'
import {
  type PgTypeMapping,
  typeConversion,
  typeMappings,
} from './typeConversion'
import { dedent } from './util/dedent'
import { unquote } from './util/unquote'

export async function generate(
  env: Env,
  filePaths: string[],
  signal?: AbortSignal,
) {
  const client = await env.client

  const { funcsWithSetof } = await prepareForMigration(filePaths, env)

  log('Migrating database...')
  await migrate(env)

  if (await generatePluginQueries(env)) {
    return
  }

  log('Generating type definitions...')

  // 1. Collect type information from the database.
  const namespaces = await introspectNamespaces(client, signal)

  const extendedTypeMappings = [...typeMappings]
  const extendedTypeConversion = { ...typeConversion }
  const oidToEnumType = new Map<number, PgEnumType>()
  const oidToCompositeType = new Map<number, PgCompositeType>()

  // 2. Add types to the type conversion map.
  for (const nsp of Object.values(namespaces)) {
    const addExtendedType = (type: PgTypeMapping) => {
      extendedTypeConversion[type.oid] = type.name
      extendedTypeMappings.push(type)
    }

    for (const type of nsp.enumTypes) {
      oidToEnumType.set(type.oid, type)
      addExtendedType({
        oid: type.oid,
        name: type.typname,
        jsType: pascal(type.typname),
        schema: nsp.name,
      })

      oidToEnumType.set(type.typarray, type)
      addExtendedType({
        oid: type.typarray,
        name: type.typname + '[]',
        jsType: pascal(type.typname) + '[]',
        schema: nsp.name,
      })
    }

    for (const type of nsp.compositeTypes) {
      oidToCompositeType.set(type.oid, type)
      addExtendedType({
        oid: type.oid,
        name: type.typname,
        jsType: pascal(type.typname),
        schema: nsp.name,
      })

      oidToCompositeType.set(type.typarray, type)
      addExtendedType({
        oid: type.typarray,
        name: type.typname + '[]',
        jsType: pascal(type.typname) + '[]',
        schema: nsp.name,
      })
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
      const enumType = oidToEnumType.get(typeOid)
      const compositeType = oidToCompositeType.get(typeOid)
      const introspectedType = enumType || compositeType

      if (introspectedType) {
        if (enumType) {
          if (!renderedObjects.has(enumType)) {
            renderedObjects.set(enumType, renderEnumType(enumType))
          }
        } else if (compositeType) {
          if (!renderedObjects.has(compositeType)) {
            // First set an empty string to avoid infinite recursion if there
            // happens to be a circular reference.
            renderedObjects.set(compositeType, '')
            renderedObjects.set(
              compositeType,
              renderCompositeType(compositeType),
            )
          }
        }
        if (introspectedType.nspname !== context) {
          type = addNamespacePrefix(
            introspectedType.typname,
            introspectedType.nspname,
            context,
          )
        } else {
          type = pascal(introspectedType.typname)
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

  // 3. Render type definitions for each function. This also builds up a list of
  // dependencies (e.g. imports and type definitions).
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

      let TRow: string | undefined
      if (fn.proretset) {
        const setofType = funcsWithSetof.find(
          setofType =>
            fn.proname === unquote(setofType.id.name) &&
            fn.nspname === unquote(setofType.id.schema ?? 'public'),
        )
        if (setofType) {
          TRow = addNamespacePrefix(
            unquote(setofType.referencedId.name),
            unquote(setofType.referencedId.schema ?? 'public'),
            fn.nspname,
          )
        } else {
          const columns = await introspectResultSet(client, fn, signal)

          TRow = `{${columns
            .map(({ name, dataTypeID }) => {
              return `${name}: ${renderTypeReference(dataTypeID, fn.nspname)}`
            })
            .join(', ')}}`
        }
      }

      const TParams = argNames ? `{${argTypes}}` : `[${argTypes}]`
      const TResult = TRow ?? renderTypeReference(fn.prorettype, fn.nspname)

      const declare = fn.proretset ? 'declareRoutine' : 'declareScalarRoutine'
      imports.add(declare)

      const fnCode = dedent`
        export declare namespace ${jsName} {
          export type Params = ${TParams}
          export type Result = ${TResult}
        }

        export const ${jsName} = ${declare}<${jsName}.Params, ${jsName}.Result>(${JSON.stringify(fn.proname)}${params}${schema})\n\n
      `

      renderedObjects.set(fn, fnCode)
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

  // 4. Render type definitions for each namespace.
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

  // 5. Write the generated type definitions to a file.
  fs.writeFileSync(env.config.typescript.outFile, code.replace(/\s+$/, '\n'))

  // 6. Warn about any unsupported types.
  for (const typeOid of unsupportedTypes) {
    const typeName = await client.scalar<string>(sql`
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

async function generatePluginQueries(env: Env) {
  if (!env.config.plugins.some(p => p.queries)) {
    return false
  }

  log('Running plugins...')

  const pluginDsn = new URL(env.config.dev.connectionString)
  pluginDsn.username = 'nano_plugin'
  pluginDsn.password = ''

  const client = await env.client
  await client.query(sql`
    DO $$ 
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'nano_plugin') THEN
        CREATE ROLE nano_plugin NOINHERIT;

        -- Grant connect permission to the new role
        GRANT CONNECT ON DATABASE ${sql.id(pluginDsn.pathname.slice(1))} TO nano_plugin;

        -- Grant usage on schema public to the new role
        GRANT USAGE ON SCHEMA public TO nano_plugin;

        -- Grant select permission on all tables in public schema to the new role
        GRANT SELECT ON ALL TABLES IN SCHEMA public TO nano_plugin;

        -- Alter default privileges to grant select on future tables to the new role
        ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO nano_plugin;
      END IF;
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
          plugin.name.replace(/\//g, '__') + '.sql',
        )

        let oldContent = ''
        try {
          oldContent = fs.readFileSync(outFile, 'utf8')
        } catch (error: any) {
          if (error.code !== 'ENOENT') {
            throw error
          }
        }

        const content = await pluginClient.stringify(template)
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

    for (const { file, content } of pluginSqlFiles) {
      fs.writeFileSync(file, content)
    }
  } else {
    log.success('Plugin-generated SQL is up to date')
  }

  return count > 0
}

function reverseLookup<K extends string, V extends string>(
  lookup: Record<K, V>,
) {
  return new Map(Object.entries(lookup).map(([key, value]) => [value, key]))
}
