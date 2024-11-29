import fs from 'node:fs'
import path from 'node:path'
import { type Client, PgResultError, sql } from 'pg-nano'
import { map, sift } from 'radashi'
import type { Plugin, SQLTemplate } from '../config/plugin.js'
import { debug, traceDepends } from '../debug.js'
import type { Env } from '../env.js'
import { events } from '../events.js'
import {
  inspectDependencies,
  type PgDependentObject,
} from '../inspector/dependencies.js'
import {
  diffTableColumns,
  hasCompositeTypeChanged,
  hasRoutineSignatureChanged,
  hasViewChanged,
} from '../inspector/diff.js'
import { createIdentityCache } from '../inspector/identity.js'
import type { PgBaseType } from '../inspector/types.js'
import { linkObjectStatements } from '../linker/link.js'
import { extractColumnDefinition } from '../parser/column.js'
import { SQLIdentifier } from '../parser/identifier.js'
import { parseObjectStatements } from '../parser/parse.js'
import type { PgObjectStmt } from '../parser/types.js'
import { cwdRelative } from '../util/path.js'

export async function prepareDatabase(
  objectStmts: PgObjectStmt[],
  baseTypes: PgBaseType[],
  env: Env,
) {
  const pg = await env.client

  // Plugins may add to the object list, so run them before linking the object
  // dependencies together.
  const pluginsByStatementId = await preparePluginStatements(
    env,
    baseTypes,
    objectStmts,
  )

  debug('plugin statements prepared')

  // Since pg-schema-diff is still somewhat limited, we have to create our own
  // dependency graph, so we can ensure all objects (and their dependencies)
  // exist before pg-schema-diff works its magic.
  const sortedObjectStmts = linkObjectStatements(objectStmts)

  if (traceDepends.enabled) {
    for (const stmt of sortedObjectStmts) {
      const name = `${stmt.kind} ${stmt.id.toQualifiedName()}`
      if (stmt.dependencies.size > 0) {
        traceDepends(
          `${name}\n${Array.from(
            stmt.dependencies,
            (dep, index) =>
              `${index === stmt.dependencies.size - 1 ? '└─' : '├─'} ${dep.id.toQualifiedName()}`,
          ).join('\n')}`,
        )
      } else {
        traceDepends('\x1b[2m%s (none)\x1b[0m', name)
      }
    }
  }

  // The "nano" schema is used to store temporary objects during diffing.
  await pg.query(sql`
    DROP SCHEMA IF EXISTS nano CASCADE;
    CREATE SCHEMA nano;
  `)
  try {
    await updateObjects(pg, objectStmts)
  } finally {
    // Drop the "nano" schema now that diffing is complete.
    await pg.query(sql`
      DROP SCHEMA IF EXISTS nano CASCADE;
    `)
  }

  fs.rmSync(env.schemaDir, { recursive: true, force: true })
  fs.mkdirSync(env.schemaDir, { recursive: true })

  const indexWidth = String(sortedObjectStmts.size).length

  let stmtIndex = 1
  for (const stmt of sortedObjectStmts) {
    const name = sift([
      String(stmtIndex++).padStart(indexWidth, '0'),
      stmt.kind === 'extension' ? stmt.kind : null,
      stmt.id.schema,
      stmt.id.name,
    ])

    const outFile = path.join(env.schemaDir, name.join('-') + '.sql')
    fs.writeFileSync(
      outFile,
      '-- file://' + stmt.file + '#L' + stmt.line + '\n' + stmt.query + ';\n',
    )
  }

  return { pluginsByStatementId }
}

async function updateObjects(pg: Client, objectStmts: PgObjectStmt[]) {
  const objectIds = createIdentityCache(pg)
  const objectNames = new Set<string>()
  const objectUpdates = new Map(
    objectStmts.map(stmt => [stmt, Promise.withResolvers<any>()] as const),
  )

  /**
   * Generate a DROP command for an object that (directly or indirectly) depends
   * on another object that is about to be dropped.
   */
  function dropDependentObject(
    object: PgDependentObject,
  ): SQLTemplate | undefined {
    const id = sql.id(object.schema, object.name)
    switch (object.type) {
      case 'pg_attrdef':
        return sql`ALTER TABLE ${id} ALTER COLUMN ${sql.id(object.column!)} DROP DEFAULT;`
      case 'pg_proc':
        return sql`DROP ROUTINE ${id} CASCADE;`
      case 'pg_type':
        return sql`DROP TYPE ${id} CASCADE;`
    }
    switch (object.relKind) {
      case 'r':
        if (object.column) {
          return sql`ALTER TABLE ${id} DROP COLUMN ${sql.id(object.column)} CASCADE;`
        }
        return sql`DROP TABLE ${id} CASCADE;`
      case 'v':
        return sql`DROP VIEW ${id} CASCADE;`
    }
  }

  /**
   * Generate DROP commands for all objects that depend on the specified object.
   */
  async function dropDependentObjects(oid: number, columns?: string[]) {
    const cascade = await inspectDependencies(pg, oid, columns)
    const drops: SQLTemplate[] = []
    for (const object of cascade) {
      const drop = dropDependentObject(object)
      if (drop) {
        drops.push(drop)
        objectIds.delete(new SQLIdentifier(object.name, object.schema))
      }
    }
    if (drops.length > 0) {
      return sql.join('\n', drops)
    }
  }

  async function updateObject(stmt: PgObjectStmt): Promise<any> {
    const nameAlreadyExists = objectNames.has(stmt.id.name)
    objectNames.add(stmt.id.name)

    // Wait for dependencies to be created/updated before proceeding.
    if (stmt.dependencies.size > 0) {
      await Promise.all(
        Array.from(stmt.dependencies).map(
          dependency => objectUpdates.get(dependency)?.promise,
        ),
      )
    }

    let query: SQLTemplate | undefined

    const oid = await objectIds.get(stmt.kind, stmt.id)
    if (oid) {
      if (stmt.kind === 'type') {
        if (stmt.subkind === 'composite') {
          if (await hasCompositeTypeChanged(pg, stmt)) {
            query = sql`
              ${await dropDependentObjects(oid)}
              DROP TYPE ${stmt.id.toSQL()} CASCADE;
              ${sql.unsafe(stmt.query)}
            `
          }
        }
      } else if (stmt.kind === 'routine') {
        if (await hasRoutineSignatureChanged(pg, stmt)) {
          query = sql`
            ${await dropDependentObjects(oid)}
            DROP ROUTINE ${stmt.id.toSQL()} CASCADE;
            ${sql.unsafe(stmt.query)}
          `
        }
      } else if (stmt.kind === 'table') {
        const { addedColumns, droppedColumns } = await diffTableColumns(
          pg,
          stmt,
        )

        // Drop any objects that depend on the columns being dropped.
        if (droppedColumns.length > 0) {
          if (debug.enabled) {
            debug(
              'columns being dropped from "%s" table:',
              stmt.id.toQualifiedName(),
              droppedColumns,
            )
          }
          const drops = await dropDependentObjects(oid, droppedColumns)
          if (drops) {
            query = sql`${drops}`
          }
        }

        if (addedColumns.length > 0) {
          if (debug.enabled) {
            debug(
              'columns being added to "%s" table:',
              stmt.id.toQualifiedName(),
              addedColumns,
            )
          }

          const alterStmts = await map(addedColumns, async name => {
            const index = stmt.columns.findIndex(c => c.name === name)
            const column = stmt.columns[index]
            const columnDDL = extractColumnDefinition(column, stmt)

            // If the primary key is being changed, we need to drop the constraint
            // for the old primary key first.
            let precondition: SQLTemplate | undefined

            if (/ primary key/i.test(columnDDL)) {
              const oldPrimaryKey = await pg.queryValue<string>(sql`
                SELECT c.conname
                FROM pg_constraint c
                JOIN pg_class t ON t.oid = c.conrelid
                WHERE
                  t.relname = ${stmt.id.nameVal}
                  AND t.relnamespace = ${stmt.id.schemaVal}::regnamespace
                  AND c.contype = 'p'
              `)

              if (oldPrimaryKey) {
                // None of the objects managed by pg-nano will be affected by
                // this drop, so skip the `dropDependentObjects` call.
                precondition = sql`
                  ALTER TABLE ${stmt.id.toSQL()}
                  DROP CONSTRAINT ${sql.id(oldPrimaryKey)} CASCADE;
                `
              }
            }

            const addColumnStmt = sql`
              ALTER TABLE ${stmt.id.toSQL()} ADD COLUMN ${sql.unsafe(columnDDL)};
            `

            return sql`
              ${precondition}
              ${addColumnStmt}
            `
          })

          query = sql`${sql.join('\n', [query, ...alterStmts])}`
        }
      } else if (stmt.kind === 'view') {
        // Consider removing this when pg-schema-diff adds support for views:
        //   https://github.com/stripe/pg-schema-diff/issues/135
        if (await hasViewChanged(pg, stmt)) {
          query = sql`
            ${await dropDependentObjects(oid)}
            DROP VIEW ${stmt.id.toSQL()} CASCADE;
            ${sql.unsafe(stmt.query)}
          `
        }
      }
      if (query) {
        events.emit('update-object', { object: stmt })
      }
    } else {
      if (nameAlreadyExists) {
        events.emit('name-collision', { object: stmt })
        return
      }

      events.emit('create-object', { object: stmt })
      query = sql.unsafe(stmt.query)

      // If an object of the same name already exists, we need to drop it before
      // creating the new object. This can happen when changing a CREATE TYPE
      // statement to a CREATE TABLE statement, for example.
      const conflict = await pg.queryRowOrNull<{
        oid: number
        relkind: string
      }>(sql`
        SELECT c.oid, c.relkind::text
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace 
        WHERE c.relname = ${stmt.id.nameVal}
          AND n.nspname = ${stmt.id.schemaVal}
      `)

      if (conflict) {
        const kind = {
          r: 'TABLE',
          v: 'VIEW',
          c: 'TYPE',
        }[conflict.relkind]

        if (kind) {
          query = sql`
            ${await dropDependentObjects(conflict.oid)}
            DROP ${sql.unsafe(kind)} ${stmt.id.toSQL()} CASCADE;
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
    objectStmts.map(stmt => {
      const { resolve } = objectUpdates.get(stmt)!
      return updateObject(stmt).then(resolve, async error => {
        const oid = await objectIds.get(stmt.kind, stmt.id)
        throwFormattedQueryError(error, stmt, !!oid)
      })
    }),
  )
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

function getLineFromPosition(position: number, query: string) {
  let line = 1
  for (let i = 0; i < position; i++) {
    if (query[i] === '\n') {
      line++
    }
  }
  return line
}
