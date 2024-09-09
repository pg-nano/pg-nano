import fs from 'node:fs'
import path from 'node:path'
import { PgResultError, sql } from 'pg-nano'
import { group, map, memo } from 'radashi'
import { hasCompositeTypeChanged } from './diff'
import type { Env } from './env'
import { linkObjectStatements } from './linkObjectStatements'
import { log } from './log'
import type { SQLIdentifier } from './parseIdentifier'
import {
  type ParsedObjectStmt,
  type ParsedObjectType,
  parseObjectStatements,
} from './parseObjectStatements'
import { dedent } from './util/dedent'
import { cwdRelative } from './util/path.js'

export async function prepareForMigration(filePaths: string[], env: Env) {
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
      log.warn('Could not check if object exists: %s (%s)', id.toString(), type)
      return false
    }

    const { from, schemaKey, nameKey } = objectExistence[type]

    return client.queryOneColumn<boolean>(sql`
      SELECT EXISTS (
        SELECT 1
        FROM ${sql.id(from)}
        WHERE ${sql.id(schemaKey)} = ${id.schemaVal}${schemaKey.endsWith('namespace') ? sql.unsafe('::regnamespace') : ''}
          AND ${sql.id(nameKey)} = ${id.nameVal}
      );
    `)
  })

  const allObjects = parsedSchemaFiles.flatMap(schemaFile => schemaFile.objects)
  const sortedObjects = linkObjectStatements(allObjects)

  // The "nano" schema is used to store temporary objects during diffing.
  await client.query(sql`
    DROP SCHEMA IF EXISTS nano CASCADE;
    CREATE SCHEMA nano;
  `)

  const handleError = async (error: Error, object: ParsedObjectStmt) => {
    let message = error.message.replace(/^ERROR:\s+/i, '').trimEnd()

    // Remove "LINE XXX: " if present, and the same number of characters from any
    // lines that come after.
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

    const id = object.id.toString()
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

    log.error(message + '\n    at ' + cwdRelative(object.file) + ':' + line)
    process.exit(1)
  }

  // Since pg-schema-diff is still somewhat limited, we have to create our own
  // dependency graph, so we can ensure all objects (and their dependencies)
  // exist before pg-schema-diff works its magic.
  for (const object of sortedObjects) {
    if (object.dependents.size > 0 && !(object.type in objectExistence)) {
      log.warn(
        'Missing %s {%s} required by %s other statement%s:',
        object.type,
        object.id.toString(),
        object.dependents.size,
        object.dependents.size === 1 ? 's' : '',
      )
      for (const dependent of object.dependents) {
        log.warn('  * %s {%s}', dependent.type, dependent.id.toString())
      }
      continue
    }

    if (await doesObjectExist(object.type, object.id)) {
      if (object.type === 'type') {
        if (object.subtype === 'composite') {
          if (await hasCompositeTypeChanged(client, object)) {
            log('Updating composite type %s', object.id.toString())
            const results = await client
              .query(sql`
                DROP TYPE ${object.id.toSQL()} CASCADE;
                ${sql.unsafe(object.query)}
              `)
              .catch(error => {
                handleError(error, object)
              })
          }
        }
      }
    } else {
      await client.query(sql.unsafe(object.query)).catch(error => {
        handleError(error, object)
      })
    }
  }

  // Drop the "nano" schema now that diffing is complete.
  await client.query(sql`
    DROP SCHEMA IF EXISTS nano CASCADE;
  `)

  const prePlanFile = path.join(env.untrackedDir, 'pre-plan.sql')
  fs.writeFileSync(prePlanFile, prePlanDDL)

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
