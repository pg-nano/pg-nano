import { type Client, sql } from 'pg-nano'
import type { SQLIdentifier } from './identifier'
import type {
  PgCompositeTypeStmt,
  PgFunctionStmt,
} from './parseObjectStatements.js'

/**
 * Compare a type to an existing type in the database.
 *
 * @returns `true` if the type has changed, `false` otherwise.
 */
export async function hasCompositeTypeChanged(
  client: Client,
  type: PgCompositeTypeStmt,
) {
  const tmpId = type.id.withSchema('nano')
  const tmpStmt = type.query.replace(
    type.id.toRegExp(),
    tmpId.toQualifiedName(),
  )

  // Add the latest type to the database (but under the "nano" schema), so we
  // can compare it to the existing type.
  await client.query(sql`
    DROP TYPE IF EXISTS ${tmpId.toSQL()} CASCADE;
    ${sql.unsafe(tmpStmt)}
  `)

  const selectTypeById = (id: SQLIdentifier) => sql`
    SELECT
      array_agg(
        (a.attname, a.atttypid, a.attnum)
        ORDER BY a.attnum
      ) AS columns
    FROM
      pg_attribute a
    JOIN
      pg_type t ON t.oid = a.attrelid
    WHERE
      t.typname = ${id.nameVal}
      AND t.typnamespace = ${id.schemaVal}::regnamespace
      AND t.typtype = 'c'
  `

  const hasChanges = await client.queryOneColumn<boolean>(sql`
    WITH type1 AS (
      ${selectTypeById(type.id)}
    ),
    type2 AS (
      ${selectTypeById(tmpId)}
    )
    SELECT
      t1.columns <> t2.columns AS has_changes
    FROM
      type1 t1,
      type2 t2;
  `)

  return hasChanges
}

/**
 * Compare a routine to an existing routine in the database.
 *
 * @returns `true` if the routine has changed, `false` otherwise.
 */
export async function hasRoutineTypeChanged(
  client: Client,
  fn: PgFunctionStmt,
) {
  const tmpId = fn.id.withSchema('nano')
  const tmpStmt = fn.query.replace(fn.id.toRegExp(), tmpId.toQualifiedName())

  // Add the latest routine to the database (but under the "nano" schema), so we
  // can compare it to the existing routine.
  await client.query(sql`
    DROP ROUTINE IF EXISTS ${tmpId.toSQL()} CASCADE;
    ${sql.unsafe(tmpStmt)}
  `)

  const selectRoutineById = (id: SQLIdentifier) => sql`
    SELECT
      p.proargtypes::oid[] AS argument_types,
      p.prorettype AS return_type,
      p.provariadic AS variadic_type,
      p.prokind AS function_kind
    FROM
      pg_proc p
    WHERE
      p.proname = ${id.nameVal}
      AND p.pronamespace = ${id.schemaVal}::regnamespace
  `

  const hasChanges = await client.queryOneColumn<boolean>(sql`
    WITH routine1 AS (
      ${selectRoutineById(fn.id)}
    ),
    routine2 AS (
      ${selectRoutineById(tmpId)}
    )
    SELECT
      r1.argument_types <> r2.argument_types OR
      r1.return_type <> r2.return_type OR
      r1.variadic_type <> r2.variadic_type OR
      r1.function_kind <> r2.function_kind AS has_changes
    FROM
      routine1 r1,
      routine2 r2;
  `)

  return hasChanges
}
