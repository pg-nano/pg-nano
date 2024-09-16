import {
  buildResult,
  sql,
  type Client,
  type QueryHook,
  type Result,
  type SQLTemplate,
} from 'pg-nano'
import { uid } from 'radashi'
import type { PgViewStmt } from './parseObjectStatements.js'
import { parseViewSubquery } from './parseViewSubquery.js'
import type {
  PgBaseType,
  PgCompositeType,
  PgEnumType,
  PgNamespace,
  PgRoutine,
  PgTable,
} from './pgTypes.js'

export async function introspectNamespaces(
  client: Client,
  signal?: AbortSignal,
) {
  const [routines, compositeTypes, enumTypes, tables] = await Promise.all([
    introspectRoutines(client, signal),
    introspectCompositeTypes(client, signal),
    introspectEnumTypes(client, signal),
    introspectTables(client, signal),
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
    [routines, 'functions'],
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

export function introspectRoutines(pg: Client, signal?: AbortSignal) {
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
  `

  return pg.queryRowList<PgRoutine>(query, { signal })
}

export async function introspectViews(pg: Client, signal?: AbortSignal) {
  const query = sql`
    SELECT
      n.nspname,
      v.viewname,
      v.viewquery
    FROM pg_catalog.pg_view v
  `
}

export function introspectBaseTypes(client: Client, signal?: AbortSignal) {
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

  return client.queryRowList<PgBaseType>(query, { signal })
}

export function introspectEnumTypes(client: Client, signal?: AbortSignal) {
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

  return client.queryRowList<PgEnumType>(query, { signal })
}

export function introspectCompositeTypes(client: Client, signal?: AbortSignal) {
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

  return client.queryRowList<PgCompositeType>(query, { signal })
}

export function introspectTables(client: Client, signal?: AbortSignal) {
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

  return client.queryRowList<PgTable>(query, { signal })
}

export async function introspectViewFields(
  pg: Client,
  view: PgViewStmt,
  signal?: AbortSignal,
) {
  return introspectResultSet(pg, sql.unsafe(parseViewSubquery(view)), 0, signal)
}

export async function introspectResultSet(
  pg: Client,
  command: SQLTemplate,
  paramCount = 0,
  signal?: AbortSignal,
) {
  const stmtName = 'pg_nano_' + uid(12)
  const commandText = await pg.stringify(command)

  await sendCommand(
    pg,
    libpq => libpq.sendPrepare(stmtName, commandText, paramCount),
    signal,
  )

  const description = await sendCommand(
    pg,
    libpq => {
      libpq.describePrepared(stmtName)
      return async () => buildResult(libpq, pg.config.fieldCase)
    },
    signal,
  )

  await pg.query(sql`DEALLOCATE ${sql.id(stmtName)}`).withOptions({ signal })

  return description.fields
}

async function sendCommand<TResult = Result[]>(
  client: Client,
  hook: QueryHook<TResult>,
  signal?: AbortSignal,
) {
  // biome-ignore lint/complexity/useLiteralKeys: Protected access
  const connection = client['getConnection'](signal)
  // biome-ignore lint/complexity/useLiteralKeys: Protected access
  return client['dispatchQuery'](connection, hook, signal)
}
