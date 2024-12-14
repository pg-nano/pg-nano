import { type Client, sql } from 'pg-nano'
import { map } from 'radashi'
import type { SQLTemplate } from '../config/plugin.js'
import { debug } from '../debug.js'
import { events } from '../events.js'
import {
  type CollationCache,
  createCollationCache,
} from '../inspector/collation.js'
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
import {
  createIdentityCache,
  type IdentityCache,
} from '../inspector/identity.js'
import type { NameResolver } from '../inspector/name.js'
import { extractColumnDefinition } from '../parser/column.js'
import { SQLIdentifier } from '../parser/identifier.js'
import type { PgSchema } from '../parser/parse.js'
import { SQLTypeIdentifier } from '../parser/typeIdentifier.js'
import type { PgObjectStmt } from '../parser/types.js'
import { memo } from '../util/memo.js'
import { memoAsync } from '../util/memoAsync.js'
import { throwFormattedQueryError } from './error.js'

/**
 * Update the database schema before generating a migration plan with
 * pg-schema-diff, so any features we support that pg-schema-diff doesn't will
 * be applied.
 */
export async function prepareObjects(
  pg: Client,
  schema: PgSchema,
  names: NameResolver,
  droppedTables: Set<SQLIdentifier>,
) {
  const objectIds = createIdentityCache(pg, names)
  const collations = createCollationCache(pg)

  // The "nano_tmp" schema is used to store temporary objects during diffing.
  await pg.query(sql`
    DROP SCHEMA IF EXISTS nano_tmp CASCADE;
    CREATE SCHEMA nano_tmp;
  `)
  try {
    await updateObjects(pg, schema, names, objectIds, collations, droppedTables)
    await updateCasts(pg, schema, objectIds)
  } finally {
    // Drop the "nano_tmp" schema now that diffing is complete.
    await pg.query(sql`
      DROP SCHEMA IF EXISTS nano_tmp CASCADE;
    `)
  }
}

async function updateObjects(
  pg: Client,
  schema: PgSchema,
  names: NameResolver,
  objectIds: IdentityCache,
  collations: CollationCache,
  droppedTables: Set<SQLIdentifier>,
) {
  const objectNames = new Set<string>()
  const objectUpdates = new Map(
    schema.objects.map(stmt => [stmt, Promise.withResolvers<any>()] as const),
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

        // Clear object from OID cache.
        await objectIds.delete(id)

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
          if (await hasCompositeTypeChanged(pg, stmt, objectIds)) {
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
      await objectIds.delete(stmt.id)
    }

    if (query) {
      events.emit('mutation:apply', {
        query: pg.stringify(query),
      })
      return pg.query(query)
    }
  }

  await Promise.all(
    schema.objects.map(stmt => {
      const { resolve } = objectUpdates.get(stmt)!
      return updateObject(stmt).then(resolve, async error => {
        throwFormattedQueryError(error, stmt, message => {
          const id = stmt.id.toQualifiedName()
          if (!message.includes(id)) {
            message = `Error preparing ${stmt.kind} (${id}): ${message}`
          }
          return message
        })
      })
    }),
  )
}

async function updateCasts(
  pg: Client,
  schema: PgSchema,
  objectIds: IdentityCache,
) {
  type Cast = {
    castsource: number
    casttarget: number
    castcontext: 'a' | 'e' | 'i'
    castfunc: number
  }

  // Note: Custom casts between two built-in (or extension) types are not
  // supported. Custom casts which don't use a function are also not supported.
  const existingCasts = await pg.queryRowList<Cast>(sql`
    SELECT
      castsource,
      casttarget,
      castcontext,
      castfunc

    FROM pg_cast
    JOIN pg_type s ON s.oid = castsource
    JOIN pg_type t ON t.oid = casttarget

    LEFT JOIN pg_depend ds
      ON ds.objid = s.oid
      AND ds.classid = 'pg_type'::regclass
      AND ds.deptype = 'e'

    LEFT JOIN pg_depend dt
      ON dt.objid = t.oid
      AND dt.classid = 'pg_type'::regclass
      AND dt.deptype = 'e'

    WHERE castmethod = 'f'
      AND ((ds.objid IS NULL AND s.typnamespace <> 'pg_catalog'::regnamespace)
        OR (dt.objid IS NULL AND t.typnamespace <> 'pg_catalog'::regnamespace))
  `)

  const queries: SQLTemplate[] = []
  const undroppedCasts = new Set<Cast>()

  await Promise.all(
    schema.casts.map(async stmt => {
      const sourceTypeOid = await objectIds.get('type', stmt.sourceId)
      const targetTypeOid = await objectIds.get('type', stmt.targetId)

      if (!sourceTypeOid) {
        throw new Error(
          `Could not update cast. Source type not found: ${stmt.sourceId.toQualifiedName()}.`,
        )
      }
      if (!targetTypeOid) {
        throw new Error(
          `Could not update cast. Target type not found: ${stmt.targetId.toQualifiedName()}.`,
        )
      }

      const cast = existingCasts.find(
        cast =>
          cast.castsource === sourceTypeOid &&
          cast.casttarget === targetTypeOid,
      )

      if (!cast) {
        queries.push(sql.unsafe(stmt.query))
        return
      }

      undroppedCasts.add(cast)

      let changed = false
      if (cast.castcontext !== stmt.context) {
        changed = true
      } else {
        const funcOid = await objectIds.get('routine', stmt.funcId)
        // TODO: check if the function arguments have changed
        if (cast.castfunc !== funcOid) {
          changed = true
        }
      }

      if (changed) {
        queries.push(sql`
          DROP CAST (${stmt.sourceId.toSQL()} AS ${stmt.targetId.toSQL()}) CASCADE;
          ${sql.unsafe(stmt.query)}
        `)
      }
    }),
  )

  const identifyTypeByOid = memo(async (oid: number) => {
    const { name, schema } = await pg.queryRow<{
      name: string
      schema: string
    }>(sql`
      SELECT
        typname AS "name",
        nspname AS "schema"
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE t.oid = ${sql.val(oid)}
    `)

    return new SQLTypeIdentifier(name, schema)
  })

  for (const cast of existingCasts) {
    if (!undroppedCasts.has(cast)) {
      const sourceId = await identifyTypeByOid(cast.castsource)
      const targetId = await identifyTypeByOid(cast.casttarget)

      queries.push(sql`
        DROP CAST (${sourceId.toSQL()} AS ${targetId.toSQL()}) CASCADE;
      `)
    }
  }

  await Promise.all(
    queries.map(query => {
      events.emit('mutation:apply', {
        query: pg.stringify(query),
      })
      return pg.query(query)
    }),
  )
}
