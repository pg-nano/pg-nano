import type { Client } from 'pg-nano'
import type { PgObjectStmtKind, SQLIdentifier } from 'pg-nano/plugin'
import { sql, type SQLTemplate } from 'pg-native'
import { traceChecks } from '../debug.js'
import { memo } from '../util/memo.js'
import type { NameResolver } from './name.js'

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

export type IdentityCache = ReturnType<typeof createIdentityCache>

export function createIdentityCache(pg: Client, names?: NameResolver) {
  const cache: Record<string, Promise<number | null>> = {}
  const getObjectId = memo(
    async (kind: PgObjectStmtKind, id: SQLIdentifier) => {
      if (traceChecks.enabled) {
        traceChecks('does %s exist?', id.toQualifiedName())
      }

      if (!(kind in objectLookupSchemes)) {
        throw new Error(`Unsupported object kind: ${kind}`)
      }

      const { from, schemaKey, nameKey, where } = objectLookupSchemes[kind]

      return pg.queryValueOrNull<number>(sql`
        SELECT oid
        FROM ${sql.id(from)}
        WHERE ${sql.id(schemaKey)} = ${id.schemaVal}${
          kind !== 'schema' ? sql`::regnamespace` : ''
        }
          ${nameKey && sql`AND ${sql.id(nameKey)} = ${id.nameVal}`}
          ${where && sql`AND ${where}`};
      `)
    },
    {
      key: (_, id) => id.toQualifiedName(),
      cache,
    },
  )

  return {
    async get(kind: PgObjectStmtKind, id: SQLIdentifier) {
      if (!id.schema && names) {
        const { schema } = await names.resolve(id.name)
        id = id.withSchema(schema)
      }
      return await getObjectId(kind, id)
    },
    delete(id: SQLIdentifier) {
      delete cache[id.toQualifiedName()]
    },
  }
}

export type IdentityMap<T> = ReturnType<typeof createIdentityMap<T>>

export function createIdentityMap<T>(defaultSchema: string) {
  const schemaMap = new Map<string, Map<string, T>>()

  return {
    get(id: SQLIdentifier) {
      const nameMap = schemaMap.get(id.schema ?? defaultSchema)
      return nameMap?.get(id.name)
    },
    set(id: SQLIdentifier, value: T) {
      const schema = id.schema ?? defaultSchema
      let nameMap = schemaMap.get(schema)
      if (!nameMap) {
        schemaMap.set(schema, (nameMap = new Map()))
      }
      nameMap.set(id.name, value)
    },
  }
}
