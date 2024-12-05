import { type Client, sql } from 'pg-nano'
import { memoAsync } from '../util/memoAsync.js'

export interface NameResolver extends ReturnType<typeof createNameResolver> {}

/**
 * The name resolver is used to resolve the schema of a type name.
 */
export function createNameResolver(pg: Client) {
  const sourceColumns = {
    pg_class: {
      name: 'relname',
      namespace: 'relnamespace',
    },
    pg_type: {
      name: 'typname',
      namespace: 'typnamespace',
    },
    pg_collation: {
      name: 'collname',
      namespace: 'collnamespace',
    },
  }

  type NameSource = keyof typeof sourceColumns
  type ResolvedName = {
    schema: string
    source: NameSource | null
    oid: number | null
    pos: number
  }

  const defaultSources: NameSource[] = ['pg_class', 'pg_type']

  return {
    resolve: memoAsync(
      async (name: string, sources: NameSource[] = defaultSources) => {
        const query = pg.queryRow<ResolvedName>(sql`
          WITH search_path AS (
            SELECT array_remove(
              string_to_array(current_setting('search_path'), ','),
              '"$user"'
            ) || 'pg_catalog'::text AS schema_list
          ),
          search_schema AS (
            SELECT
              trim(nspname) AS "nspname",
              array_position(
                (SELECT schema_list FROM search_path),
                nspname
              ) AS "rank"
            FROM unnest((SELECT schema_list FROM search_path)) AS nspname
            ORDER BY rank
          ),
          lookup AS (
            ${sql.join(
              sql.unsafe('\nUNION ALL\n'),
              sources.map(
                source => sql`
                  SELECT
                    s.oid,
                    n.nspname,
                    ${sql.val(source)} AS "source"
                  FROM ${sql.id(source)} s
                  JOIN pg_namespace n ON n.oid = ${sql.id(sourceColumns[source].namespace)}::regnamespace
                  WHERE ${sql.id(sourceColumns[source].name)} = ${sql.val(name)}
                `,
              ),
            )}
            LIMIT 1
          )
          SELECT *
          FROM (
            (SELECT
                l.nspname AS "schema",
                l.source,
                l.oid,
                rank
              FROM search_schema s
              JOIN lookup l ON l.nspname = s.nspname
              WHERE l.oid IS NOT NULL
              ORDER BY rank ASC
              LIMIT 1)

            -- If the lookup finds nothing, return the first schema that exists.
            UNION ALL
            (SELECT
                s.nspname AS "schema",
                NULL AS "source",
                NULL AS "oid",
                rank + 1000 AS "rank" -- Ensure that this result is always last.
              FROM search_schema s
              JOIN pg_namespace n ON n.nspname = s.nspname
              ORDER BY rank ASC
              LIMIT 1)
          )
          ORDER BY rank ASC
          LIMIT 1
        `)

        return query.catch(error => {
          error.message = `Failed to resolve name "${name}". Checked the following sources: ${sources.join(', ')}\n\n    ${error.message}`
          throw error
        })
      },
      {
        toKey: (name, types = defaultSources) => `${name}|${types.join(',')}`,
      },
    ),
  }
}
