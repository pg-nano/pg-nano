import type { Client } from 'pg-nano'
import type { PgObjectStmtKind, SQLIdentifier } from 'pg-nano/plugin'
import { sql, type SQLTemplate } from 'pg-native'
import { traceChecks } from '../debug.js'
import { memo } from '../util/memo.js'

type ObjectLookupScheme = {
  from: string
  schemaKey: string
  nameKey: string | undefined
  where?: SQLTemplate
}

/**
 * If an object can be referenced by other objects and pg-schema-diff doesn't
 * yet infer the dependency for its topological sorting, it needs to be added
 * to this registry so its existence can be checked.
 *
 * Currently, functions and composite types need their dependencies created
 * before the pg-schema-diff migration process begins.
 */
const objectLookupSchemes: Record<PgObjectStmtKind, ObjectLookupScheme> = {
  routine: {
    from: 'pg_proc',
    schemaKey: 'pronamespace',
    nameKey: 'proname',
  },
  table: {
    from: 'pg_class',
    schemaKey: 'relnamespace',
    nameKey: 'relname',
    where: sql`relkind IN ('r', 'p')`,
  },
  type: {
    from: 'pg_type',
    schemaKey: 'typnamespace',
    nameKey: 'typname',
  },
  view: {
    from: 'pg_class',
    schemaKey: 'relnamespace',
    nameKey: 'relname',
    where: sql`relkind = 'v'`,
  },
  schema: {
    from: 'pg_namespace',
    schemaKey: 'nspname',
    nameKey: undefined,
  },
  extension: {
    from: 'pg_extension',
    schemaKey: 'extnamespace',
    nameKey: 'extname',
  },
}

export interface ObjectIdentity {
  id: SQLIdentifier
  kind: PgObjectStmtKind
}

export function createIdentityCache(pg: Client) {
  const cache: Record<string, Promise<number | null>> = {}
  const inverseCache: Record<
    number,
    { id: SQLIdentifier; kind: PgObjectStmtKind }
  > = {}

  return {
    get: memo(
      async (kind: PgObjectStmtKind, id: SQLIdentifier) => {
        if (traceChecks.enabled) {
          traceChecks('does %s exist?', id.toQualifiedName())
        }

        if (!(kind in objectLookupSchemes)) {
          throw new Error(`Unsupported object kind: ${kind}`)
        }

        const { from, schemaKey, nameKey, where } = objectLookupSchemes[kind]

        return pg
          .queryValueOrNull<number>(sql`
          SELECT oid
          FROM ${sql.id(from)}
          WHERE ${sql.id(schemaKey)} = ${id.schemaVal}${
            kind !== 'schema' ? sql`::regnamespace` : ''
          }
            ${nameKey && sql`AND ${sql.id(nameKey)} = ${id.nameVal}`}
            ${where && sql`AND ${where}`};
        `)
          .then(oid => {
            if (oid == null) {
              inverseCache[oid] = { id, kind }
            }
            return oid
          })
      },
      {
        key: (_, id) => id.toQualifiedName(),
        cache,
      },
    ),
    delete(id: SQLIdentifier) {
      const key = id.toQualifiedName()
      cache[key]?.then(oid => {
        if (oid != null) {
          delete inverseCache[oid]
        }
      })
      delete cache[key]
    },
    /**
     * Get an `ObjectIdentity` by its OID.
     *
     * Note that only the following object kinds are supported:
     *   - table
     *   - view
     *   - routine
     *   - type
     */
    getById: memo(async (id: number) => {
      type Object = {
        name: string
        schema: string
        kind: PgObjectStmtKind
      }
      const result = await pg.queryRow<Object>(sql`
        SELECT
          relname AS "name",
          nspname AS "schema",
          CASE
            WHEN relkind = 'r' THEN 'table'
            WHEN relkind = 'v' THEN 'view'
          END AS "kind"
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace AND c.relkind <> 'c'
        WHERE c.oid = ${sql.val(id)}
        UNION ALL
        SELECT
          proname AS "name",
          nspname AS "schema",
          'routine' AS "kind"
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.oid = ${sql.val(id)}
        UNION ALL
        SELECT
          typname AS "name",
          nspname AS "schema",
          'type' AS "kind"
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.oid = ${sql.val(id)}
        LIMIT 1
      `)
    }),
  }
}
