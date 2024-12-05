import { type Client, sql } from 'pg-nano'
import { SQLIdentifier } from '../parser/identifier.js'
import { memoAsync } from '../util/memoAsync.js'

export type CollationCache = ReturnType<typeof createCollationCache>

export function createCollationCache(client: Client) {
  const getCollationByOid = memoAsync(async (collationOid: number) => {
    type Collation = {
      name: string
      schema: string
    }
    const { name, schema } = await client.queryRow<Collation>(sql`
      SELECT
        c.collname AS "name",
        n.nspname AS "schema"
      FROM pg_collation c
      JOIN pg_namespace n ON c.collnamespace = n.oid
      WHERE c.oid = ${sql.val(collationOid)}
    `)
    return new SQLIdentifier(name, schema)
  })

  const getDefaultCollation = memoAsync(async (typeOid: number) => {
    const collationOid = await client.queryValue<number>(sql`
      SELECT typcollation FROM pg_type WHERE oid = ${sql.val(typeOid)}
    `)
    return collationOid ? getCollationByOid(collationOid) : null
  })

  return {
    getDefaultCollation,
  }
}

export function compareCollations(
  left: SQLIdentifier | null,
  right: SQLIdentifier | null,
  defaultCollation: SQLIdentifier | null,
) {
  if (defaultCollation) {
    if (left === null || left.equals(defaultCollation)) {
      return right === null || right.equals(defaultCollation)
    }
    if (right === null || right.equals(defaultCollation)) {
      return false
    }
  } else {
    if (left === null) {
      return right === null
    }
    if (right === null) {
      return false
    }
  }
  return left.equals(right)
}
