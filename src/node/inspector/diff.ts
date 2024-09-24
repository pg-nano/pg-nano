import { type Client, isPgResultError, sql } from 'pg-nano'
import { select } from 'radashi'
import { debug } from '../debug.js'
import type { SQLIdentifier } from '../parser/identifier.js'
import type {
  PgCompositeTypeStmt,
  PgRoutineStmt,
  PgTableStmt,
  PgViewStmt,
} from '../parser/types.js'
import { appendCodeFrame } from '../util/codeFrame.js'

/**
 * Returns a set of column names that were added to the table.
 */
export async function findAddedTableColumns(
  client: Client,
  table: PgTableStmt,
) {
  if (debug.enabled) {
    debug('did %s have columns added?', table.id.toQualifiedName())
  }

  const existingNames = await client.queryValueList<string>(sql`
    SELECT
      a.attname
    FROM
      pg_class c
    JOIN
      pg_attribute a ON a.attrelid = c.oid
    WHERE
      c.relname = ${table.id.nameVal}
      AND c.relnamespace = ${table.id.schemaVal}::regnamespace
      AND a.attnum > 0
      AND NOT a.attisdropped
  `)

  return select(
    table.columns,
    col => col.name,
    col => !existingNames.includes(col.name),
  )
}

/**
 * Compare a type to an existing type in the database.
 *
 * @returns `true` if the type has changed, `false` otherwise.
 */
export async function hasCompositeTypeChanged(
  client: Client,
  type: PgCompositeTypeStmt,
) {
  if (debug.enabled) {
    debug('did %s change?', type.id.toQualifiedName())
  }

  type ExistingColumn = {
    name: string
    type_oid: number
  }

  const [existingColumns, columnTypeOids] = await Promise.all([
    client.queryRowList<ExistingColumn>(sql`
      SELECT
        a.attname AS name,
        a.atttypid AS type_oid
      FROM
        pg_type t
      JOIN
        pg_attribute a ON a.attrelid = t.typrelid
      WHERE
        t.typname = ${type.id.nameVal}
        AND t.typnamespace = ${type.id.schemaVal}::regnamespace
        AND t.typtype = 'c'
        AND a.attnum > 0
        AND NOT a.attisdropped
      ORDER BY a.attnum
    `),
    client.queryValueList<number>(sql`
      SELECT
        t.oid
      FROM
        pg_type t
      WHERE
        t.typname = ${type.id.nameVal}
        AND t.typnamespace = ${type.id.schemaVal}::regnamespace
    `),
  ])

  const hasChanges =
    type.columns.length !== existingColumns.length ||
    type.columns.some((col, index) => {
      const existingCol = existingColumns[index]
      return (
        col.name !== existingCol.name ||
        columnTypeOids[index] !== existingCol.type_oid
      )
    })

  console.log({ hasChanges, existingColumns, columnTypeOids })

  return hasChanges
}

/**
 * Compare a the type signature of parsed CREATE routine statement to an
 * existing routine in the database.
 *
 * Bodies are not compared, since pg-schema-diff handles that.
 *
 * @returns `true` if the routine has changed, `false` otherwise.
 */
export async function hasRoutineSignatureChanged(
  client: Client,
  fn: PgRoutineStmt,
) {
  const tmpId = fn.id.withSchema('nano')
  const tmpStmt = fn.query.replace(fn.id.toRegExp(), tmpId.toQualifiedName())

  // Add the latest routine to the database (but under the "nano" schema), so we
  // can compare it to the existing routine.
  await client
    .query(sql`
      DROP ROUTINE IF EXISTS ${tmpId.toSQL()} CASCADE;
      ${sql.unsafe(tmpStmt)}
    `)
    .catch(error => {
      if (isPgResultError(error) && error.statementPosition) {
        appendCodeFrame(
          error,
          +error.statementPosition,
          error.ddl,
          fn.line - 2,
          fn.file,
        )
      }
      throw error
    })

  const selectRoutineById = (id: SQLIdentifier) => sql`
    SELECT
      coalesce(p.proargnames, '{}') AS argument_names,
      coalesce(p.proargmodes, '{}') AS argument_modes,
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

  if (debug.enabled) {
    debug('did %s change?', fn.id.toQualifiedName())
  }

  const hasChanges = await client.queryValue<boolean>(sql`
    WITH routine1 AS (
      ${selectRoutineById(fn.id)}
    ),
    routine2 AS (
      ${selectRoutineById(tmpId)}
    )
    SELECT
      r1.argument_names <> r2.argument_names OR
      r1.argument_types <> r2.argument_types OR
      r1.argument_modes <> r2.argument_modes OR
      r1.return_type <> r2.return_type OR
      r1.variadic_type <> r2.variadic_type OR
      r1.function_kind <> r2.function_kind AS has_changes
    FROM
      routine1 r1,
      routine2 r2;
  `)

  return hasChanges
}

/**
 * Checks if a view has changed by comparing the existing view with a temporary
 * version created in the "nano" schema.
 *
 * @returns `true` if the view has changed, `false` otherwise.
 */
export async function hasViewChanged(client: Client, view: PgViewStmt) {
  const tmpId = view.id.withSchema('nano')
  const tmpStmt = view.query.replace(
    view.id.toRegExp(),
    tmpId.toQualifiedName(),
  )

  // Create a temporary version of the view in the "nano" schema
  await client.query(sql`
    DROP VIEW IF EXISTS ${tmpId.toSQL()} CASCADE;
    ${sql.unsafe(tmpStmt)}
  `)

  const selectViewDefinition = (id: SQLIdentifier) => sql`
    SELECT pg_get_viewdef(${id.toSQL()}::regclass) AS view_definition
  `

  const hasChanges = await client.queryValue<boolean>(sql`
    WITH view1 AS (
      ${selectViewDefinition(view.id)}
    ),
    view2 AS (
      ${selectViewDefinition(tmpId)}
    )
    SELECT
      v1.view_definition <> v2.view_definition AS has_changes
    FROM
      view1 v1,
      view2 v2;
  `)

  return hasChanges
}
