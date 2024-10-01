import type { Client } from 'pg-nano'
import { type SQLTemplate, sql } from 'pg-native'
import { uid } from 'radashi'
import type { PgViewStmt } from '../parser/types.js'
import { parseViewSubquery } from './parseViewSubquery.js'
import type {
  PgBaseType,
  PgCompositeType,
  PgEnumType,
  PgNamespace,
  PgRoutine,
  PgTable,
} from './types.js'

export async function inspectNamespaces(client: Client, signal?: AbortSignal) {
  const [routines, compositeTypes, enumTypes, tables] = await Promise.all([
    inspectRoutines(client, signal),
    inspectCompositeTypes(client, signal),
    inspectEnumTypes(client, signal),
    inspectTables(client, signal),
  ])

  const namespaces: Record<string, PgNamespace> = {}
  const getNamespace = (schema: string) =>
    (namespaces[schema] ??= {
      schema,
      routines: [],
      compositeTypes: [],
      enumTypes: [],
      tables: [],
      names: [],
    })

  for (const [objects, collection] of [
    [routines, 'routines'],
    [compositeTypes, 'compositeTypes'],
    [enumTypes, 'enumTypes'],
    [tables, 'tables'],
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
      AND t.typarray <> 0
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
        'hasNotNull', a.attnotnull
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
        'identity', a.attidentity
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

export async function inspectViewFields(
  client: Client,
  view: PgViewStmt,
  signal?: AbortSignal,
) {
  return inspectResultSet(client, sql.unsafe(parseViewSubquery(view)), signal)
}

export async function inspectResultSet(
  client: Client,
  command: SQLTemplate,
  signal?: AbortSignal,
) {
  const name = 'pg_nano_' + uid(12)
  await client
    .query(sql`PREPARE ${sql.id(name)} AS ${command}`)
    .cancelWithSignal(signal)

  const [description] = await client
    .query(pq => {
      pq.describePrepared(name)
      setImmediate(() => pq.emit('readable'))
      return true
    })
    .cancelWithSignal(signal)

  console.log('inspectResultSet', { description })

  await client.query(sql`DEALLOCATE ${sql.id(name)}`).cancelWithSignal(signal)

  return description.fields
}
