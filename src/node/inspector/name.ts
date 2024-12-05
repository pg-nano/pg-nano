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

  const defaultSources: NameSource[] = ['pg_class', 'pg_type']

  return {
    resolve: memoAsync(
      async (name: string, sources: NameSource[] = defaultSources) => {
        const result = await pg
          .queryRow<{ schema: string; oid: number }>(sql`
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
              ) AS "pos"
            FROM unnest((SELECT schema_list FROM search_path)) AS nspname
            ORDER BY pos
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
          SELECT
            l.nspname AS "schema",
            l.source,
            l.oid,
            s.pos
          FROM search_schema s
          JOIN lookup l ON l.nspname = s.nspname
          WHERE l.oid IS NOT NULL
          ORDER BY s.pos
          LIMIT 1
        `)
          .catch(error => {
            error.message = `Failed to resolve name "${name}". Checked the following sources: ${sources.join(', ')}\n\n    ${error.message}`
            throw error
          })
        console.log('names.resolve', { name, result })
        return result
      },
      {
        toKey: (name, types = defaultSources) => `${name}|${types.join(',')}`,
      },
    ),
  }
}
