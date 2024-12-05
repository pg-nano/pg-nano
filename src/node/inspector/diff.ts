import { isPgResultError, sql, type Client } from 'pg-nano'
import { traceChecks } from '../debug.js'
import { SQLIdentifier } from '../parser/identifier.js'
import { SQLTypeIdentifier } from '../parser/typeIdentifier.js'
import type {
  PgCompositeTypeStmt,
  PgRoutineStmt,
  PgTableColumnDef,
  PgTableStmt,
  PgViewStmt,
} from '../parser/types.js'
import { arrayEquals } from '../util/arrayEquals.js'
import { appendCodeFrame } from '../util/codeFrame.js'
import { compareCollations, type CollationCache } from './collation.js'
import type { IdentityCache } from './identity.js'
import type { NameResolver } from './name.js'

/**
 * Returns a set of column names that were added to the table.
 */
export async function diffTableColumns(
  client: Client,
  table: PgTableStmt,
  names: NameResolver,
  collations: CollationCache,
) {
  if (traceChecks.enabled) {
    traceChecks('did %s change its columns?', table.id.toQualifiedName())
  }

  type ColumnInfo = {
    name: string
    type: string
    typeOid: number
    collationSchema: string | null
    collationName: string | null
  }

  const existingColumns = await client.queryRowList<ColumnInfo>(sql`
    SELECT
      a.attname AS name,
      n.nspname || '.' || t.typname ||
        CASE
          WHEN a.atttypmod = -1 THEN ''
          ELSE '(' ||
            COALESCE(
              information_schema._pg_char_max_length(a.atttypid, a.atttypmod),
              a.atttypmod
            ) || ')'
        END ||
        repeat('[]', a.attndims) AS type,
      t.oid AS type_oid,
      (
        SELECT n.nspname
        FROM pg_namespace n
        WHERE n.oid = co.collnamespace
      ) AS collation_schema,
      co.collname AS collation_name
    FROM
      pg_attribute a
    JOIN
      pg_class c ON c.oid = a.attrelid
    JOIN
      pg_type t
        ON (t.oid = a.atttypid AND t.typcategory <> 'A')
        OR t.typarray = a.atttypid
    LEFT JOIN
      pg_collation co ON co.oid = a.attcollation
    JOIN
      pg_namespace n ON n.oid = t.typnamespace
    WHERE
      c.relname = ${table.id.nameVal}
      AND c.relnamespace = ${table.id.schemaVal}::regnamespace
      AND a.attnum > 0
      AND NOT a.attisdropped
  `)

  type ColumnChange =
    | {
        kind: 'type'
        column: PgTableColumnDef
        oldType: SQLTypeIdentifier
        newType: SQLTypeIdentifier
      }
    | {
        kind: 'collation'
        column: PgTableColumnDef
        oldCollation: SQLIdentifier | null
        newCollation: SQLIdentifier | null
      }

  const addedColumns: string[] = []
  const changedColumns: ColumnChange[] = []
  const droppedColumns: string[] = []

  for (const col of table.columns) {
    if (!existingColumns.some(c => c.name === col.name)) {
      addedColumns.push(col.name)
    }
  }
  for (const old of existingColumns) {
    const col = table.columns.find(col => {
      return col.name === old.name
    })
    if (!col) {
      droppedColumns.push(old.name)
    } else {
      const oldType = SQLTypeIdentifier.parse(old.type)
      const newType = col.type

      // Infer the schema from the type name if it's not explicitly set.
      oldType.schema ??= (await names.resolve(oldType.name)).schema
      newType.schema ??= (await names.resolve(newType.name)).schema

      const typeDiff = diffTypeIdentifiers(oldType, newType)

      // If the type is unchanged, check if the collation has changed.
      if (!typeDiff) {
        const defaultCollation = await collations.getDefaultCollation(
          old.typeOid,
        )

        let oldCollation: SQLIdentifier | null
        if (old.collationName) {
          oldCollation = new SQLIdentifier(
            old.collationName,
            old.collationSchema ??
              (await names.resolve(old.collationName, ['pg_collation'])).schema,
          )
        } else {
          oldCollation = defaultCollation
        }

        if (
          !compareCollations(oldCollation, col.collationName, defaultCollation)
        ) {
          changedColumns.push({
            kind: 'collation',
            column: col,
            oldCollation,
            newCollation: col.collationName ?? defaultCollation,
          })
        }
      } else {
        if (col.isPrimaryKey && /^(bp)?char$/.test(col.type.name)) {
          console.warn(
            `[pg-nano] Using "${col.type.name}" in a primary key is discouraged.\n` +
              `Consider changing ${table.id.withField(col.name).toQualifiedName()} to use varchar instead:\n` +
              `  https://wiki.postgresql.org/wiki/Don%27t_Do_This#Don.27t_use_char.28n.29_even_for_fixed-length_identifiers`,
          )
        }

        changedColumns.push({
          kind: 'type',
          column: col,
          oldType,
          newType: col.type,
        })
      }
    }
  }

  return { addedColumns, changedColumns, droppedColumns }
}

function diffTypeIdentifiers(
  left: SQLTypeIdentifier,
  right: SQLTypeIdentifier,
) {
  if (left.schema !== right.schema) {
    return 'schema'
  }
  if (left.name !== right.name) {
    return 'name'
  }
  if (!arrayEquals(left.typeModifiers, right.typeModifiers)) {
    return 'typeModifiers'
  }
  if (!arrayEquals(left.arrayBounds, right.arrayBounds)) {
    return 'arrayBounds'
  }
  return null
}

/**
 * Compare a type to an existing type in the database.
 *
 * @returns `true` if the type has changed, `false` otherwise.
 */
export async function hasCompositeTypeChanged(
  client: Client,
  type: PgCompositeTypeStmt,
  objectIds: IdentityCache,
) {
  if (traceChecks.enabled) {
    traceChecks('did %s change?', type.id.toQualifiedName())
  }

  type ExistingColumn = {
    name: string
    typeOid: number
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
    Promise.all(type.columns.map(col => objectIds.get('type', col.type))),
  ])

  return (
    type.columns.length !== existingColumns.length ||
    type.columns.some((col, index) => {
      const existingCol = existingColumns[index]
      return (
        col.name !== existingCol.name ||
        columnTypeOids[index] !== existingCol.typeOid
      )
    })
  )
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
  const tmpId = fn.id.withSchema('nano_tmp')
  const tmpStmt = fn.query.replace(fn.id.toRegExp(), tmpId.toQualifiedName())

  // Create a temporary routine in the "nano_tmp" schema so we can compare it to
  // the existing routine.
  await client.query(sql.unsafe(tmpStmt)).catch(error => {
    if (isPgResultError(error) && error.statementPosition) {
      appendCodeFrame(
        error,
        +error.statementPosition,
        error.command,
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
      COALESCE(
        p.proallargtypes::oid[],
        ARRAY(SELECT unnest(p.proargtypes))
      ) AS parameter_types,
      p.prorettype AS return_type,
      p.proretset AS returns_set,
      p.provariadic AS variadic_type,
      p.prokind AS function_kind
    FROM
      pg_proc p
    WHERE
      p.proname = ${id.nameVal}
      AND p.pronamespace = ${id.schemaVal}::regnamespace
  `

  if (traceChecks.enabled) {
    traceChecks('did %s change?', fn.id.toQualifiedName())
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
      r1.argument_modes <> r2.argument_modes OR
      r1.parameter_types <> r2.parameter_types OR
      r1.return_type <> r2.return_type OR
      r1.returns_set <> r2.returns_set OR
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
  const tmpId = view.id.withSchema('nano_tmp')
  const tmpStmt = view.query.replace(
    view.id.toRegExp(),
    tmpId.toQualifiedName(),
  )

  // Create a temporary view in the "nano_tmp" schema so we can compare it to
  // the existing view.
  await client.query(sql.unsafe(tmpStmt))

  const selectViewDefinition = (id: SQLIdentifier) => sql`
    SELECT pg_get_viewdef(${sql.val(id.toQualifiedName())}::regclass) AS view_definition
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
