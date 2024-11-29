import type { Client } from 'pg-nano'
import type { PgObjectStmtKind, SQLIdentifier } from 'pg-nano/plugin'
import { sql, type SQLTemplate } from 'pg-native'
import { traceChecks } from '../debug.js'
import { memo } from '../util/memo.js'

type ObjectLookupScheme = {
  from: string
  schemaKey: string
  nameKey: string
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
const objectLookupSchemes: Record<
  Exclude<PgObjectStmtKind, 'schema'>,
  ObjectLookupScheme
> = {
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
  extension: {
    from: 'pg_extension',
    schemaKey: 'extnamespace',
    nameKey: 'extname',
  },
}

export function createIdentityCache(pg: Client) {
  const cache: Record<string, Promise<number | null>> = {}

  return {
    get: memo(
      async (kind: PgObjectStmtKind, id: SQLIdentifier) => {
        if (traceChecks.enabled) {
          traceChecks('does %s exist?', id.toQualifiedName())
        }

        if (kind === 'schema') {
          return pg.queryValueOrNull<number>(sql`
            SELECT ${id.schemaVal}::regnamespace;
          `)
        }

        if (!(kind in objectLookupSchemes)) {
          throw new Error(`Unsupported object kind: ${kind}`)
        }

        const { from, schemaKey, nameKey, where } = objectLookupSchemes[kind]

        return pg.queryValueOrNull<number>(sql`
          SELECT oid
          FROM ${sql.id(from)}
          WHERE ${sql.id(schemaKey)} = ${id.schemaVal}::regnamespace
            AND ${sql.id(nameKey)} = ${id.nameVal}
            ${where && sql`AND ${where}`};
        `)
      },
      {
        key: (_, id) => id.toQualifiedName(),
        cache,
      },
    ),
    delete(id: SQLIdentifier) {
      delete cache[id.toQualifiedName()]
    },
  }
}
