import type { Plugin } from '@pg-nano/plugin'
import fs from 'node:fs'
import path from 'node:path'
import { PgResultError, sql } from 'pg-nano'
import { group, map, memo } from 'radashi'
import { hasCompositeTypeChanged, hasRoutineTypeChanged } from './diff'
import type { Env } from './env'
import type { SQLIdentifier } from './identifier'
import { linkObjectStatements } from './linkObjectStatements'
import { log } from './log'
import {
  type ParsedObjectStmt,
  type ParsedObjectType,
  parseObjectStatements,
} from './parseObjectStatements'
import { dedent } from './util/dedent'
import { cwdRelative } from './util/path.js'

export async function prepareDatabase(filePaths: string[], env: Env) {
  const client = await env.client

  fs.rmSync(env.schemaDir, { recursive: true, force: true })
  fs.mkdirSync(env.schemaDir, { recursive: true })

  const { pre: prePlanFiles, rest: schemaFiles = [] } = group(
    filePaths,
    file => {
      const name = path.basename(file)
      return name[0] === '!' ? 'pre' : 'rest'
    },
  )

  let prePlanDDL = dedent`
    SET check_function_bodies = off;\n\n
  `

  if (prePlanFiles) {
    prePlanDDL +=
      prePlanFiles.map(file => fs.readFileSync(file, 'utf8')).join('\n\n') +
      '\n\n'
  }

  const parsedSchemaFiles = await map(schemaFiles, async file => {
    const content = fs.readFileSync(file, 'utf8')
    const objects = await parseObjectStatements(content, file)
    return { file, objects }
  })

  type ObjectExistenceConfig = {
    from: string
    schemaKey: string
    nameKey: string
  }

  /**
   * If an object can be referenced by other objects and pg-schema-diff doesn't
   * yet infer the dependency for its topological sorting, it needs to be added
   * to this registry so its existence can be checked.
   *
   * Currently, functions and composite types need their dependencies created
   * before the pg-schema-diff migration process begins.
   */
  const objectExistence: Record<ParsedObjectType, ObjectExistenceConfig> = {
    function: {
      from: 'pg_proc',
      schemaKey: 'pronamespace',
      nameKey: 'proname',
    },
    table: {
      from: 'pg_tables',
      schemaKey: 'schemaname',
      nameKey: 'tablename',
    },
    type: {
      from: 'pg_type',
      schemaKey: 'typnamespace',
      nameKey: 'typname',
    },
    view: {
      from: 'pg_views',
      schemaKey: 'schemaname',
      nameKey: 'viewname',
    },
    extension: {
      from: 'pg_extension',
      schemaKey: 'extnamespace',
      nameKey: 'extname',
    },
  }

  const doesObjectExist = memo((type: ParsedObjectType, id: SQLIdentifier) => {
    if (!(type in objectExistence)) {
      log.warn(
        'Could not check if object exists: %s (%s)',
        id.toQualifiedName(),
        type,
      )
      return false
    }

    const { from, schemaKey, nameKey } = objectExistence[type]

    return client.queryOneValue<boolean>(sql`
      SELECT EXISTS (
        SELECT 1
        FROM ${sql.id(from)}
        WHERE ${sql.id(schemaKey)} = ${id.schemaVal}${schemaKey.endsWith('namespace') ? sql.unsafe('::regnamespace') : ''}
          AND ${sql.id(nameKey)} = ${id.nameVal}
      );
    `)
  })

  const allObjects = parsedSchemaFiles.flatMap(schemaFile => schemaFile.objects)

  // Plugins may add to the object list, so run them before linking the object
  // dependencies together.
  await preparePluginStatements(env, allObjects)

  const sortedObjects = linkObjectStatements(allObjects)

  // The "nano" schema is used to store temporary objects during diffing.
  await client.query(sql`
    DROP SCHEMA IF EXISTS nano CASCADE;
    CREATE SCHEMA nano;
  `)

  const formatObjectError = async (error: Error, object: ParsedObjectStmt) => {
    let message = error.message.replace(/^ERROR:\s+/i, '').trimEnd()

    // Remove "LINE XXX: " if present, and the same number of characters from
    // any lines that come after.
    const messageLines = message.split('\n')
    for (let i = 0; i < messageLines.length; i++) {
      if (messageLines[i].startsWith('LINE ')) {
        const colonIndex = messageLines[i].indexOf(':') + 2
        messageLines[i] =
          ' '.repeat(colonIndex) + messageLines[i].slice(colonIndex)
        message = messageLines.join('\n')
        break
      }
    }

    const id = object.id.toQualifiedName()
    if (!message.includes(id)) {
      const exists = await doesObjectExist(object.type, object.id)
      message = `Error ${exists ? 'updating' : 'creating'} ${object.type} (${id}): ${message}`
    }

    const line =
      error instanceof PgResultError && error.statementPosition
        ? object.line -
          1 +
          getLineFromPosition(
            Number.parseInt(error.statementPosition),
            object.query,
          )
        : object.line

    const stack =
      '\n    at ' +
      cwdRelative(object.file) +
      ':' +
      line +
      (error.stack
        ?.replace(error.name + ': ' + error.message, '')
        .replace(/^\s*(?=\n)/, '') ?? '')

    error.message = message
    error.stack = message + stack
    throw error
  }

  // Since pg-schema-diff is still somewhat limited, we have to create our own
  // dependency graph, so we can ensure all objects (and their dependencies)
  // exist before pg-schema-diff works its magic.
  for (const object of sortedObjects) {
    if (object.dependents.size > 0 && !(object.type in objectExistence)) {
      log.warn(
        'Missing %s {%s} required by %s other statement%s:',
        object.type,
        object.id.toQualifiedName(),
        object.dependents.size,
        object.dependents.size === 1 ? 's' : '',
      )
      for (const dependent of object.dependents) {
        log.warn('  * %s {%s}', dependent.type, dependent.id.toQualifiedName())
      }
      continue
    }

    if (await doesObjectExist(object.type, object.id)) {
      if (object.type === 'type') {
        if (object.subtype === 'composite') {
          if (await hasCompositeTypeChanged(client, object)) {
            log.magenta('Composite type changed:', object.id.toQualifiedName())
            await client
              .query(sql`
                DROP TYPE ${object.id.toSQL()} CASCADE;
                ${sql.unsafe(object.query)}
              `)
              .catch(error => {
                formatObjectError(error, object)
              })
          }
        }
      } else if (object.type === 'function') {
        if (await hasRoutineTypeChanged(client, object)) {
          log.magenta(
            'Function signature changed:',
            object.id.toQualifiedName(),
          )
          await client
            .query(sql`
              DROP ROUTINE ${object.id.toSQL()} CASCADE;
              ${sql.unsafe(object.query)}
            `)
            .catch(error => {
              formatObjectError(error, object)
            })
        }
      }
    } else {
      log('Creating %s %s', object.type, object.id.toQualifiedName())
      await client.query(sql.unsafe(object.query)).catch(error => {
        formatObjectError(error, object)
      })
    }
  }

  // Drop the "nano" schema now that diffing is complete.
  await client.query(sql`
    DROP SCHEMA IF EXISTS nano CASCADE;
  `)

  const prePlanFile = path.join(env.untrackedDir, 'pre-plan.sql')
  fs.writeFileSync(prePlanFile, prePlanDDL)

  let outSchema = ''
  for (const object of sortedObjects) {
    outSchema += object.query + ';\n\n'
  }

  const outFile = path.join(env.schemaDir, 'schema.sql')
  fs.writeFileSync(outFile, outSchema)

  return allObjects
}

function getLineFromPosition(position: number, query: string) {
  let line = 1
  for (let i = 0; i < position; i++) {
    if (query[i] === '\n') {
      line++
    }
  }
  return line
}

async function preparePluginStatements(
  env: Env,
  allObjects: ParsedObjectStmt[],
) {
  // Ensure that removed plugins don't leave behind any SQL files.
  fs.rmSync(env.config.generate.pluginSqlDir, {
    recursive: true,
    force: true,
  })

  // biome-ignore lint/complexity/noBannedTypes:
  type StatementsPlugin = Plugin & { statements: Function }

  const plugins = env.config.plugins.filter(
    (p): p is StatementsPlugin => p.statements != null,
  )

  if (plugins.length === 0) {
    return
  }

  fs.mkdirSync(env.config.generate.pluginSqlDir, { recursive: true })

  for (const plugin of plugins) {
    log('Generating SQL statements with plugin', plugin.name)

    const template = await plugin.statements({
      objects: allObjects,
      sql,
    })

    if (template) {
      const outFile = path.join(
        env.config.generate.pluginSqlDir,
        plugin.name.replace(/\//g, '__') + '.pgsql',
      )

      const client = await env.client
      const content = dedent(
        await client.stringify(template, { reindent: true }),
      )

      // Write to disk so the developer can see the generated SQL, and possibly
      // commit it to source control (if desired). Note that this won't trigger
      // the file watcher, since the pluginSqlDir is ignored.
      fs.writeFileSync(outFile, content)

      // Immediately parse the generated statements so they can be used by
      // plugins that run after this one.
      const objects = await parseObjectStatements(content, outFile)
      for (const object of objects) {
        if (allObjects.some(other => other.id.equals(object.id))) {
          log.warn(
            '[%s] Tried to create %s %s, but it already exists. Skipping.',
            plugin.name,
            object.type,
            object.id.toQualifiedName(),
          )
          continue
        }
        allObjects.push(object)
      }
    }
  }
}
