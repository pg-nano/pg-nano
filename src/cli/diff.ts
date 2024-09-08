import { type Client, sql } from 'pg-nano'
import type { SQLIdentifier } from './parseIdentifier'
import type { SortedStatement } from './sortStatements'

/**
 * Compare a type to the existing type in the database.
 *
 * @returns `true` if the type has changed, `false` otherwise.
 */
export async function hasTypeChanged(
  client: Client,
  type: SortedStatement,
  stmt: string,
) {
  const tmpId = type.id.withSchema('nano')
  const tmpStmt = stmt.replace(type.id.toString(), tmpId.toString())

  // Add the current type to the database (but under the "nano" schema), so we
  // can compare it to the existing type.
  await client.query(sql`
    DROP TYPE IF EXISTS ${tmpId.toSQL()} CASCADE;
    ${sql.unsafe(tmpStmt)}
  `)

  const selectTypeById = (id: SQLIdentifier) => sql`
    SELECT
      a.attname AS column_name,
      a.atttypid AS type_id,
      a.attnum AS column_number
    FROM
      pg_attribute a
    JOIN
      pg_type t ON t.oid = a.attrelid
    WHERE
      t.typname = ${id.nameVal}
      AND t.typnamespace = ${id.schemaVal}::regnamespace
    ORDER BY
      a.attnum
  `

  const hasChanges = await client.queryOneColumn<boolean>(sql`
    WITH type1 AS (
      ${selectTypeById(type.id)}
    ),
    type2 AS (
      ${selectTypeById(tmpId)}
    )
    SELECT 
      EXISTS (
        SELECT 1
        FROM (
          SELECT * FROM type1
          EXCEPT
          SELECT * FROM type2
        ) diff1
      ) OR
      EXISTS (
        SELECT 1
        FROM (
          SELECT * FROM type2
          EXCEPT
          SELECT * FROM type1
        ) diff2
      ) AS has_changes;
  `)

  return hasChanges
}
