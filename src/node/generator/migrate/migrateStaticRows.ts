import { createHash } from 'node:crypto'
import { type Client, sql } from 'pg-nano'
import { type PgTableStmt, SQLIdentifier } from 'pg-nano/plugin'
import { map } from 'radashi'
import { debug } from '../../debug.js'
import { events } from '../../events.js'
import type { PgSchema } from '../../parser/parse.js'
import { throwFormattedQueryError } from '../error.js'

export async function migrateStaticRows(
  pg: Client,
  schema: PgSchema,
  droppedTables: Set<SQLIdentifier>,
) {
  events.emit('migrate:static-rows:start')

  // If any of the dropped tables had static INSERT statements applied, forget
  // those inserts ever existed.
  if (droppedTables.size > 0) {
    await pg.query(
      sql`${Array.from(
        droppedTables,
        id => sql`
          DELETE FROM nano.inserts
          WHERE relnamespace = ${sql.val(id.schema)}
            AND relname = ${sql.val(id.name)};\n
        `,
      )}`,
    )
  }

  let insertedRowCount = 0
  let deletedRowCount = 0

  // This assumes you're not using static INSERTs to preload more data than can
  // fit in memory (which is not supported).
  const previousHashes = await pg.queryValueList<string>(sql`
    SELECT hash FROM nano.inserts;
  `)

  const currentHashes = new Set<string>()
  const insertQueue: (() => Promise<void>)[] = []

  // Note: Static INSERTs must not depend on each other, since they're not
  // sorted before they're applied.
  for (const insertStmt of schema.inserts) {
    const relationStmt = schema.objects.find(objectStmt =>
      objectStmt.id.equals(insertStmt.relationId),
    ) as PgTableStmt | undefined

    if (!relationStmt) {
      events.emit('parser:unhandled-insert', {
        insertStmt: insertStmt.node,
      })
      continue
    }

    const targetColumns =
      insertStmt.targetColumns ?? relationStmt.columns.map(col => col.name)

    const relationId = insertStmt.relationId.toQualifiedName()
    const relationHash = createHash('md5').update(relationId).digest()

    /** The table and columns to insert into. */
    const target = sql`${relationStmt.id.toSQL()} ${sql.list(
      targetColumns,
      sql.unsafe,
    )}`

    /** The columns to return from the insertion. */
    const returning = sql`RETURNING ARRAY[${sql.join(
      ',',
      relationStmt.primaryKeyColumns.map(sql.unsafe),
    )}]::text[] AS pk`

    for (const tuple of insertStmt.tuples) {
      const tupleHash = createHash('md5')
        .update(relationHash)
        .update('#')
        .update(tuple.join())
        .digest('hex')

      currentHashes.add(tupleHash)
      if (!previousHashes.includes(tupleHash)) {
        insertQueue.push(async () => {
          try {
            const insertionCTE = sql`
              INSERT INTO ${target}
              VALUES ${sql.list(tuple, sql.unsafe)}
              ${returning}
            `
            events.emit('mutation:apply', {
              query: pg.stringify(insertionCTE),
            })
            await pg.query(sql`
              WITH inserted AS (
                ${insertionCTE}
              )
              INSERT INTO nano.inserts (hash, relname, relnamespace, pk)
              SELECT
                ${sql.val(tupleHash)},
                ${sql.val(relationStmt.id.name)},
                ${sql.val(relationStmt.id.schema)},
                inserted.pk
              FROM inserted;
            `)
            insertedRowCount++
          } catch (error: any) {
            console.error(error)
            throwFormattedQueryError(error, insertStmt, message => {
              return `Error inserting into "${relationId}": ${message}`
            })
          }
        })
      }
    }

    // Perform deletions before insertions, to avoid primary key conflicts.
    for (const hash of previousHashes) {
      if (currentHashes.has(hash)) {
        continue
      }

      const row = await pg.queryRow<{
        table: string
        schema: string
        pk: string[]
      }>(sql`
        SELECT
          relname AS "table",
          relnamespace AS "schema",
          pk
        FROM nano.inserts
        WHERE hash = ${sql.val(hash)};
      `)

      const relationId = new SQLIdentifier(row.table, row.schema)
      const relationStmt = schema.objects.find(objectStmt =>
        objectStmt.id.equals(relationId),
      ) as PgTableStmt | undefined

      if (!relationStmt) {
        continue
      }

      try {
        const deletion = sql`
          DELETE FROM ${relationStmt.id.toSQL()}
          WHERE ${sql.join(
            sql.unsafe(' AND '),
            relationStmt.primaryKeyColumns.map((name, index) => {
              return sql`${sql.id(name)} = ${sql.val(row.pk[index])}`
            }),
          )};
        `
        events.emit('mutation:apply', {
          query: pg.stringify(deletion),
        })
        await pg.query(sql`
          ${deletion}
          DELETE FROM nano.inserts WHERE hash = ${sql.val(hash)};
        `)
        deletedRowCount++
      } catch (error) {
        // The deletion is best effort, so don't rethrow.
        debug('Error deleting from', relationId.toQualifiedName(), error)
      }
    }

    await map(insertQueue, fn => fn())
  }

  events.emit('migrate:static-rows:end', {
    insertedRowCount,
    deletedRowCount,
  })
}
