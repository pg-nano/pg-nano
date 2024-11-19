import fs from 'node:fs'
import path from 'node:path'
import { PgResultError, sql } from 'pg-nano'
import { map, memo, sift } from 'radashi'
import type { Plugin, SQLTemplate } from '../config/plugin.js'
import { debug, traceChecks, traceDepends } from '../debug.js'
import type { Env } from '../env.js'
import { events } from '../events.js'
import {
  findAddedTableColumns,
  hasCompositeTypeChanged,
  hasRoutineSignatureChanged,
} from '../inspector/diff.js'
import type { PgBaseType } from '../inspector/types.js'
import { linkObjectStatements } from '../linker/link.js'
import { extractColumnDefinition } from '../parser/column.js'
import type { SQLIdentifier } from '../parser/identifier.js'
import { parseObjectStatements } from '../parser/parse.js'
import type { PgObjectStmt, PgObjectStmtKind } from '../parser/types.js'
import { cwdRelative } from '../util/path.js'

export async function prepareDatabase(
  objects: PgObjectStmt[],
  baseTypes: PgBaseType[],
  env: Env,
) {
  const pg = await env.client

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
  const objectExistence: Record<PgObjectStmtKind, ObjectExistenceConfig> = {
    routine: {
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

  const doesObjectExist = memo((type: PgObjectStmtKind, id: SQLIdentifier) => {
    if (!(type in objectExistence)) {
      return false
    }

    if (traceChecks.enabled) {
      traceChecks('does %s exist?', id.toQualifiedName())
    }

    const { from, schemaKey, nameKey } = objectExistence[type]

    return pg.queryValue<boolean>(sql`
      SELECT EXISTS (
        SELECT 1
        FROM ${sql.id(from)}
        WHERE ${sql.id(schemaKey)} = ${id.schemaVal}${schemaKey.endsWith('namespace') ? sql.unsafe('::regnamespace') : ''}
          AND ${sql.id(nameKey)} = ${id.nameVal}
      );
    `)
  })

  // Plugins may add to the object list, so run them before linking the object
  // dependencies together.
  const pluginsByStatementId = await preparePluginStatements(
    env,
    baseTypes,
    objects,
  )

  debug('plugin statements prepared')

  // Since pg-schema-diff is still somewhat limited, we have to create our own
  // dependency graph, so we can ensure all objects (and their dependencies)
  // exist before pg-schema-diff works its magic.
  const sortedObjects = linkObjectStatements(objects)

  // The "nano" schema is used to store temporary objects during diffing.
  await pg.query(sql`
    DROP SCHEMA IF EXISTS nano CASCADE;
    CREATE SCHEMA nano;
  `)

  if (traceDepends.enabled) {
    for (const object of sortedObjects) {
      if (object.dependencies.size > 0) {
        traceDepends(
          '%s %s depends on %s',
          object.kind,
          object.id.toQualifiedName(),
          Array.from(object.dependencies)
            .map(dep => dep.id.toQualifiedName())
            .join(', '),
        )
      } else {
        traceDepends(
          '%s %s has no dependencies',
          object.kind,
          object.id.toQualifiedName(),
        )
      }
    }
  }

  const objectNames = new Set<string>()

  const objectUpdates = new Map(
    objects.map(object => [object, Promise.withResolvers<any>()] as const),
  )

  async function updateObject(object: PgObjectStmt): Promise<any> {
    const nameAlreadyExists = objectNames.has(object.id.name)
    objectNames.add(object.id.name)

    if (!(object.kind in objectExistence)) {
      events.emit('unsupported-object', { object })
      return
    }

    const exists = await doesObjectExist(object.kind, object.id)

    // Wait for dependencies to be created/updated before proceeding.
    if (object.dependencies.size > 0) {
      await Promise.all(
        Array.from(object.dependencies).map(
          dependency => objectUpdates.get(dependency)?.promise,
        ),
      )
    }

    let query: SQLTemplate | undefined

    if (exists) {
      if (object.kind === 'type') {
        if (object.subkind === 'composite') {
          if (await hasCompositeTypeChanged(pg, object)) {
            events.emit('update-object', { object })
            query = sql`
              DROP TYPE ${object.id.toSQL()} CASCADE;
              ${sql.unsafe(object.query)}
            `
          }
        }
      } else if (object.kind === 'routine') {
        if (await hasRoutineSignatureChanged(pg, object)) {
          events.emit('update-object', { object })
          query = sql`
            DROP ROUTINE ${object.id.toSQL()} CASCADE;
            ${sql.unsafe(object.query)}
          `
        }
      } else if (object.kind === 'table') {
        const addedColumns = await findAddedTableColumns(pg, object)

        if (addedColumns.length > 0) {
          events.emit('update-object', { object })

          if (debug.enabled) {
            debug(
              'found new columns in "%s" table:',
              object.id.toQualifiedName(),
              addedColumns,
            )
          }

          const alterStmts = await map(addedColumns, async name => {
            const index = object.columns.findIndex(c => c.name === name)
            const column = object.columns[index]
            const columnDDL = extractColumnDefinition(column, object)

            // If the primary key is being changed, we need to drop the constraint
            // for the old primary key first.
            let precondition: SQLTemplate | undefined

            if (/ primary key/i.test(columnDDL)) {
              const oldPrimaryKey = await pg.queryValue<string>(sql`
                SELECT c.conname
                FROM pg_constraint c
                JOIN pg_class t ON t.oid = c.conrelid
                WHERE
                  t.relname = ${object.id.nameVal}
                  AND t.relnamespace = ${object.id.schemaVal}::regnamespace
                  AND c.contype = 'p'
              `)

              if (oldPrimaryKey) {
                precondition = sql`
                  ALTER TABLE ${object.id.toSQL()}
                  DROP CONSTRAINT ${sql.id(oldPrimaryKey)} CASCADE;
                `
              }
            }

            const addColumnStmt = sql`
              ALTER TABLE ${object.id.toSQL()} ADD COLUMN ${sql.unsafe(columnDDL)};
            `

            return sql`
              ${precondition}
              ${addColumnStmt}
            `
          })

          query = sql`${sql.join('\n', alterStmts)}`
        }
      }
    } else {
      if (nameAlreadyExists) {
        events.emit('name-collision', { object })
        return
      }

      events.emit('create-object', { object })
      query = sql.unsafe(object.query)

      // If an object of the same name already exists, we need to drop it before
      // creating the new object. This can happen when changing a CREATE TYPE
      // statement to a CREATE TABLE statement, for example.
      const existingKind = await pg.queryValueOrNull<string>(sql`
        SELECT c.relkind::text
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace 
        WHERE c.relname = ${object.id.nameVal}
          AND n.nspname = ${object.id.schemaVal}
      `)

      if (existingKind) {
        const dropType =
          existingKind === 'r'
            ? 'TABLE'
            : existingKind === 'v'
              ? 'VIEW'
              : existingKind === 'c'
                ? 'TYPE'
                : null

        if (dropType) {
          query = sql`
            DROP ${sql.unsafe(dropType)} ${object.id.toSQL()} CASCADE;

            ${query}
          `
        }
      }
    }

    if (query) {
      const result = await pg.query(query)
      events.emit('prepare:mutation', { query: query.command! })
      return result
    }
  }

  await Promise.all(
    objects.map(object => {
      const { resolve } = objectUpdates.get(object)!
      return updateObject(object).then(resolve, async error => {
        const exists = await doesObjectExist(object.kind, object.id)
        throwFormattedQueryError(error, object, exists)
      })
    }),
  )

  // Drop the "nano" schema now that diffing is complete.
  await pg.query(sql`
    DROP SCHEMA IF EXISTS nano CASCADE;
  `)

  fs.rmSync(env.schemaDir, { recursive: true, force: true })
  fs.mkdirSync(env.schemaDir, { recursive: true })

  const indexWidth = String(sortedObjects.size).length

  let objectIndex = 1
  for (const object of sortedObjects) {
    const name = sift([
      String(objectIndex++).padStart(indexWidth, '0'),
      object.kind === 'extension' ? object.kind : null,
      object.id.schema,
      object.id.name,
    ])

    const outFile = path.join(env.schemaDir, name.join('-') + '.sql')
    fs.writeFileSync(
      outFile,
      '-- file://' +
        object.file +
        '#L' +
        object.line +
        '\n' +
        object.query +
        ';\n',
    )
  }

  return { pluginsByStatementId }
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
  baseTypes: PgBaseType[],
  objects: PgObjectStmt[],
) {
  // Ensure that removed plugins don't leave behind any SQL files.
  fs.rmSync(env.config.generate.pluginSqlDir, {
    recursive: true,
    force: true,
  })

  type StatementsPlugin = Plugin & { statements: Function }

  const plugins = env.config.plugins.filter(
    (p): p is StatementsPlugin => p.statements != null,
  )

  const pluginsByStatementId = new Map<string, StatementsPlugin>()

  if (plugins.length === 0) {
    return pluginsByStatementId
  }

  fs.mkdirSync(env.config.generate.pluginSqlDir, { recursive: true })

  for (const plugin of plugins) {
    events.emit('plugin:statements', { plugin })

    const template = await plugin.statements({ objects }, env.config)

    if (template) {
      const outFile = path.join(
        env.config.generate.pluginSqlDir,
        plugin.name.replace(/\//g, '__') + '.pgsql',
      )

      const pg = await env.client
      const content = pg.stringify(template, {
        reindent: true,
      })

      // Write to disk so the developer can see the generated SQL, and possibly
      // commit it to source control (if desired). Note that this won't trigger
      // the file watcher, since the pluginSqlDir is ignored.
      fs.writeFileSync(outFile, content)

      // Immediately parse the generated statements so they can be used by
      // plugins that run after this one.
      const newObjects = await parseObjectStatements(
        content,
        outFile,
        baseTypes,
      )
      for (const object of newObjects) {
        if (objects.some(other => other.id.equals(object.id))) {
          events.emit('name-collision', { object })
          continue
        }
        objects.push(object)
        pluginsByStatementId.set(object.id.toQualifiedName(), plugin)
      }
    }
  }

  return pluginsByStatementId
}

function throwFormattedQueryError(
  error: Error,
  object: PgObjectStmt,
  exists: boolean,
): never {
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
    message = `Error ${exists ? 'updating' : 'creating'} ${object.kind} (${id}): ${message}`
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

function nonUnique<T>(array: readonly T[]) {
  const seen = new Set<T>()
  return array.filter((value, index, arr) => {
    if (seen.has(value)) {
      return true
    }
    seen.add(value)
    return false
  })
}
