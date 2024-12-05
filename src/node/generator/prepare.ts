import fs from 'node:fs'
import path from 'node:path'
import { type Client, sql } from 'pg-nano'
import { map, sift } from 'radashi'
import type { Plugin, SQLTemplate } from '../config/plugin.js'
import { debug, traceDepends } from '../debug.js'
import type { Env } from '../env.js'
import { events } from '../events.js'
import { createCollationCache } from '../inspector/collation.js'
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
import { createNameResolver } from '../inspector/name.js'
import type { PgBaseType } from '../inspector/types.js'
import { linkObjectStatements } from '../linker/link.js'
import { extractColumnDefinition } from '../parser/column.js'
import { SQLIdentifier } from '../parser/identifier.js'
import { parseSQLStatements } from '../parser/parse.js'
import type { PgInsertStmt, PgObjectStmt } from '../parser/types.js'
import { memoAsync } from '../util/memoAsync.js'
import { throwFormattedQueryError } from './error.js'

export async function prepareDatabase(
  objectStmts: PgObjectStmt[],
  insertStmts: PgInsertStmt[],
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
    insertStmts,
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

  events.emit('prepare:start')

  const droppedTables = new Set<SQLIdentifier>()

  // The "nano_tmp" schema is used to store temporary objects during diffing.
  await pg.query(sql`
    DROP SCHEMA IF EXISTS nano_tmp CASCADE;
    CREATE SCHEMA nano_tmp;
  `)
  try {
    await updateObjects(pg, objectStmts, droppedTables)
  } finally {
    // Drop the "nano_tmp" schema now that diffing is complete.
    await pg.query(sql`
      DROP SCHEMA IF EXISTS nano_tmp CASCADE;
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

  return {
    droppedTables,
    pluginsByStatementId,
    sortedObjectStmts,
  }
}

async function updateObjects(
  pg: Client,
  objectStmts: PgObjectStmt[],
  droppedTables: Set<SQLIdentifier>,
) {
  const names = createNameResolver(pg)
  const objectIds = createIdentityCache(pg)
  const collations = createCollationCache(pg)

  const objectNames = new Set<string>()
  const objectUpdates = new Map(
    objectStmts.map(stmt => [stmt, Promise.withResolvers<any>()] as const),
  )

  // The schema-qualified names of objects that will be dropped.
  const droppedNames = new Set<string>()

  const getCastContext = memoAsync(
    async (sourceOid: number, targetOid: number) => {
      return pg.queryValueOrNull<'a' | 'e' | 'i'>(sql`
        SELECT castcontext
        FROM pg_cast
        WHERE castsource = ${sql.val(sourceOid)}
          AND casttarget = ${sql.val(targetOid)}
      `)
    },
    {
      toKey: (sourceOid, targetOid) => `${sourceOid}>${targetOid}`,
    },
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
      const id = new SQLIdentifier(object.name, object.schema)
      const name = id.toQualifiedName()
      if (droppedNames.has(name)) {
        continue
      }
      droppedNames.add(name)

      // Generate a DROP command but don't execute it yet.
      const drop = dropDependentObject(object)
      if (drop) {
        drops.push(drop)

        objectIds.delete(id)
        if (object.relKind === 'r') {
          droppedTables.add(id)
        }
      }
    }
    if (drops.length > 0) {
      if (debug.enabled) {
        debug(
          `dropping dependent objects => \n${drops.map(drop => pg.stringify(drop)).join('\n')}`,
        )
      }
      return sql.join('\n', drops)
    }
  }

  async function updateObject(stmt: PgObjectStmt): Promise<any> {
    const name = stmt.id.toQualifiedName()
    const nameAlreadyExists = objectNames.has(name)
    objectNames.add(name)

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
        const { addedColumns, droppedColumns, changedColumns } =
          await diffTableColumns(pg, stmt, names, collations)

        if (changedColumns.length > 0) {
          if (debug.enabled) {
            debug('columns being changed in "%s" table:', name, changedColumns)
          }

          // Drop any objects that depend on the columns being changed.
          const drops = await dropDependentObjects(
            oid,
            changedColumns.map(change => change.column.name),
          )
          if (drops) {
            query = sql`${drops}`
          }

          const alterStmts: SQLTemplate[] = []
          for (const change of changedColumns) {
            const { column } = change
            switch (change.kind) {
              case 'type': {
                const { oldType, newType } = change

                let transform: SQLTemplate
                if (
                  oldType.name === 'bigint' &&
                  newType.name === 'timestamptz'
                ) {
                  transform = sql`to_timestamp(${sql.id(column.name)} / 1000)`
                } else {
                  const castContext = await getCastContext(
                    (await objectIds.get('type', oldType))!,
                    (await objectIds.get('type', newType))!,
                  )

                  // If no type cast is defined, drop the column and
                  // pg-schema-diff will re-add it with the new type.
                  if (!castContext) {
                    alterStmts.push(sql`
                      ${await dropDependentObjects(oid, [column.name])}

                      ALTER TABLE ${stmt.id.toSQL()}
                      DROP COLUMN ${sql.id(column.name)} CASCADE;

                      ALTER TABLE ${stmt.id.toSQL()}
                      ADD COLUMN ${sql.unsafe(extractColumnDefinition(column, stmt))};
                    `)
                    continue
                  }

                  transform = sql`${sql.id(column.name)}::${newType.toSQL()}`
                }

                alterStmts.push(sql`
                  ALTER TABLE ${stmt.id.toSQL()}
                  ALTER COLUMN ${sql.id(column.name)}
                    TYPE ${newType.toSQL()}
                    USING ${transform};
                `)
                break
              }
              case 'collation': {
                if (change.newCollation) {
                  alterStmts.push(sql`
                    ALTER TABLE ${stmt.id.toSQL()}
                    ALTER COLUMN ${sql.id(column.name)}
                      TYPE ${column.type.toSQL()}
                      COLLATE ${change.newCollation.toSQL()};
                  `)
                }
                break
              }
            }
          }
          if (alterStmts.length > 0) {
            query = sql`${sql.join('\n', [query, ...alterStmts])}`
          }
        }

        // Drop any objects that depend on the columns being dropped.
        if (droppedColumns.length > 0) {
          if (debug.enabled) {
            debug(
              'columns being dropped from "%s" table:',
              name,
              droppedColumns,
            )
          }
          const drops = await dropDependentObjects(oid, droppedColumns)
          if (drops) {
            query = sql`
              ${query}
              ${drops}
            `
          }
        }

        if (addedColumns.length > 0) {
          if (debug.enabled) {
            debug('columns being added to "%s" table:', name, addedColumns)
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
              ALTER TABLE ${stmt.id.toSQL()}
              ADD COLUMN ${sql.unsafe(columnDDL)};
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
          if (conflict.relkind === 'r') {
            droppedTables.add(stmt.id)
          }

          query = sql`
            ${await dropDependentObjects(conflict.oid)}
            DROP ${sql.unsafe(kind)} ${stmt.id.toSQL()} CASCADE;
            ${query}
          `
        }
      }

      // This object will exist the next time we query its OID.
      objectIds.delete(stmt.id)
    }

    if (query) {
      events.emit('mutation:apply', {
        query: pg.stringify(query),
      })
      return pg.query(query)
    }
  }

  await Promise.all(
    objectStmts.map(stmt => {
      const { resolve } = objectUpdates.get(stmt)!
      return updateObject(stmt).then(resolve, async error => {
        const oid = await objectIds.get(stmt.kind, stmt.id)
        throwFormattedQueryError(error, stmt, message => {
          const id = stmt.id.toQualifiedName()
          if (!message.includes(id)) {
            message = `Error ${oid ? 'updating' : 'creating'} ${stmt.kind} (${id}): ${message}`
          }
          return message
        })
      })
    }),
  )
}

async function preparePluginStatements(
  env: Env,
  baseTypes: PgBaseType[],
  objects: PgObjectStmt[],
  inserts: PgInsertStmt[],
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
      const parsedOutput = await parseSQLStatements(content, outFile, baseTypes)

      for (const object of parsedOutput.objectStmts) {
        if (objects.some(other => other.id.equals(object.id))) {
          events.emit('name-collision', { object })
          continue
        }
        objects.push(object)
        pluginsByStatementId.set(object.id.toQualifiedName(), plugin)
      }

      for (const insert of parsedOutput.insertStmts) {
        const relation = objects.find(object =>
          object.id.equals(insert.relationId),
        )

        if (!relation || !parsedOutput.objectStmts.includes(relation)) {
          events.emit('prepare:skip-insert', { insert })
          continue
        }

        inserts.push(insert)
      }
    }
  }

  return pluginsByStatementId
}
