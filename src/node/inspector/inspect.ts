import { parseQuery, type SelectStmt } from '@pg-nano/pg-parser'
import type { Client, CommandResult } from 'pg-nano'
import { getResult, sql, type SQLTemplate } from 'pg-native'
import { uid } from 'radashi'
import { inspectSelect } from './select.js'
import type {
  PgBaseType,
  PgCompositeType,
  PgEnumType,
  PgField,
  PgNamespace,
  PgObject,
  PgRoutine,
  PgTable,
  PgView,
} from './types.js'

export async function inspectNamespaces(client: Client, signal?: AbortSignal) {
  const [routines, compositeTypes, enumTypes, tables, views] =
    await Promise.all([
      inspectRoutines(client, signal),
      inspectCompositeTypes(client, signal),
      inspectEnumTypes(client, signal),
      inspectTables(client, signal),
      inspectViews(client, signal),
    ])

  const namespaces: Record<string, PgNamespace> = {}
  const getNamespace = (schema: string) =>
    (namespaces[schema] ??= {
      schema,
      routines: [],
      compositeTypes: [],
      enumTypes: [],
      tables: [],
      views: [],
      names: [],
    })

  for (const [objects, collection] of [
    [routines, 'routines'],
    [compositeTypes, 'compositeTypes'],
    [enumTypes, 'enumTypes'],
    [tables, 'tables'],
    [views, 'views'],
  ] as const) {
    for (const object of objects) {
      const nsp = getNamespace(object.schema)
      nsp[collection].push(object as any)
      nsp.names.push(object.name)
    }
  }

  return namespaces
}

export function inspectRoutines(client: Client, signal?: AbortSignal) {
  /**
   * Find the procs that are:
   *   - not built-in
   *   - not added by extensions
   *   - not related to a trigger
   */
  const query = sql`
    SELECT
      'routine'::text AS "type",
      p.prokind AS "kind",
      p.oid,
      p.proname AS "name",
      n.nspname AS "schema",
      p.proargnames AS "paramNames",
      p.proargtypes::int[] AS "paramTypes",
      p.proargmodes::text[] AS "paramKinds",
      p.pronargdefaults AS "numDefaultParams",
      p.prorettype AS "returnTypeOid",
      p.proretset AS "returnSet",
      p.provariadic AS "isVariadic"
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    LEFT JOIN pg_catalog.pg_depend d ON d.objid = p.oid AND d.deptype = 'e'
    LEFT JOIN pg_catalog.pg_extension e ON e.oid = d.refobjid
    WHERE
      (p.prokind = 'f' OR p.prokind = 'p')
      AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND e.oid IS NULL
      AND p.prorettype != 2279 -- trigger
    ORDER BY n.nspname, p.proname
  `

  return client.queryRowList<PgRoutine>(query).cancelWithSignal(signal)
}

// export async function inspectViews(client: Client, signal?: AbortSignal) {
//   const query = sql`
//     SELECT
//       n.nspname,
//       v.viewname,
//       v.viewquery
//     FROM pg_catalog.pg_view v
//   `
// }

export function inspectBaseTypes(client: Client, signal?: AbortSignal) {
  const query = sql`
    SELECT
      'base type'::text AS "type",
      t.oid,
      t.typname AS "name",
      n.nspname AS "schema",
      t.typarray::oid AS "arrayOid"
    FROM pg_catalog.pg_type t
    JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typtype IN ('b', 'p', 'r')
      AND (t.typarray <> 0 OR t.typtype = 'p')
      AND t.typnamespace = 'pg_catalog'::regnamespace
  `

  return client.queryRowList<PgBaseType>(query).cancelWithSignal(signal)
}

export function inspectEnumTypes(client: Client, signal?: AbortSignal) {
  const query = sql`
    SELECT
      'enum type'::text AS "type",
      t.oid,
      t.typname AS "name",
      n.nspname AS "schema",
      t.typarray::oid AS "arrayOid",
      array(
        SELECT enumlabel
        FROM pg_catalog.pg_enum e
        WHERE e.enumtypid = t.oid
        ORDER BY e.enumsortorder
      )::text[] AS labels
    FROM pg_catalog.pg_type t
    JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typtype = 'e'
  `

  return client.queryRowList<PgEnumType>(query).cancelWithSignal(signal)
}

export function inspectCompositeTypes(client: Client, signal?: AbortSignal) {
  const attributesQuery = sql`
    SELECT array_agg(
      json_build_object(
        'name', a.attname,
        'typeOid', a.atttypid::int,
        'hasNotNull', a.attnotnull,
        'ndims', a.attndims
      )
      ORDER BY a.attnum
    )
    FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = t.typrelid
      AND a.attnum > 0
      AND NOT a.attisdropped
  `

  const query = sql`
    SELECT
      'composite type'::text AS "type",
      t.oid,
      t.typname AS "name",
      n.nspname AS "schema",
      t.typarray::oid AS "arrayOid",
      (${attributesQuery}) AS fields
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_type t ON t.oid = c.reltype
    JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
    WHERE c.relkind = 'c'
      AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  `

  return client.queryRowList<PgCompositeType>(query).cancelWithSignal(signal)
}

export function inspectTables(client: Client, signal?: AbortSignal) {
  const attributesQuery = sql`
    SELECT array_agg(
      json_build_object(
        'name', a.attname,
        'typeOid', a.atttypid::int,
        'hasNotNull', a.attnotnull,
        'hasDefault', a.atthasdef,
        'identity', a.attidentity,
        'ndims', a.attndims
      )
      ORDER BY a.attnum
    )
    FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = t.typrelid
      AND a.attnum > 0
      AND NOT a.attisdropped
  `

  const query = sql`
    SELECT
      'table'::text AS "type",
      t.oid,
      t.typname AS "name",
      n.nspname AS "schema",
      t.typarray::oid AS "arrayOid",
      (${attributesQuery}) AS fields
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_type t ON t.oid = c.reltype
    WHERE c.relkind = 'r'
      AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  `

  return client.queryRowList<PgTable>(query).cancelWithSignal(signal)
}

export function inspectViews(client: Client, signal?: AbortSignal) {
  const query = sql`
    SELECT
      'view'::text AS "type",
      t.oid,
      t.typname AS "name",
      n.nspname AS "schema",
      t.typarray::oid AS "arrayOid",
      v.definition AS "query",
      NULL AS "fields"
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n
      ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_type t
      ON t.oid = c.reltype
    JOIN pg_catalog.pg_views v
      ON v.schemaname = n.nspname
      AND v.viewname = c.relname
    WHERE c.relkind = 'v'
      AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  `

  return client.queryRowList<PgView>(query).cancelWithSignal(signal)
}

export async function inspectViewFields(
  client: Client,
  view: PgView,
  objects: PgObject[],
  signal?: AbortSignal,
) {
  const ast = await parseQuery(view.query)
  const selectStmt = (ast.stmts[0].stmt as { SelectStmt: SelectStmt })
    .SelectStmt

  try {
    return await inspectSelect(client, selectStmt, objects, signal)
  } catch (error) {
    console.warn(error)

    // Fallback to asking the database directly. The downside of this is the
    // lack of nullability hints.
    return inspectResultSet(client, sql.unsafe(view.query), signal)
  }
}

export async function inspectResultSet(
  client: Client,
  input: SQLTemplate,
  signal?: AbortSignal,
): Promise<PgField[]> {
  const name = 'pg_nano_' + uid(12)
  await client
    .query(sql`PREPARE ${sql.id(name)} AS ${input}`)
    .cancelWithSignal(signal)

  const [description] = await client
    .query((pq, query) => {
      pq.describePrepared(name)
      return () => {
        const [error, result] = getResult(pq, query)
        if (error) {
          throw error
        }
        return [result as CommandResult]
      }
    })
    .cancelWithSignal(signal)

  await client.query(sql`DEALLOCATE ${sql.id(name)}`).cancelWithSignal(signal)

  return description.fields.map(f => ({
    name: f.name,
    typeOid: f.dataTypeID,
    hasNotNull: false,
  }))
}
