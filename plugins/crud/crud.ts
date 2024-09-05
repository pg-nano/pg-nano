import type { Plugin } from '@pg-nano/plugin'

export default function (): Plugin {
  return {
    name: '@pg-nano/plugin-crud',
    async queries({ client, sql }) {
      type PgTable = {
        name: string
        primary_key_columns: string[]
        columns: string[]
      }

      const tables = await client.many<PgTable>(sql`
        SELECT 
          t.table_name AS name,
          array_agg(kcu.column_name) FILTER (WHERE kcu.column_name IS NOT NULL) AS primary_key_columns,
          array_agg(DISTINCT c.column_name) AS columns
        FROM 
          information_schema.tables t
        LEFT JOIN 
          information_schema.table_constraints tc
            ON t.table_name = tc.table_name
            AND t.table_schema = tc.table_schema
            AND tc.constraint_type = 'PRIMARY KEY'
        LEFT JOIN 
          information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
        LEFT JOIN
          information_schema.columns c
            ON t.table_name = c.table_name
            AND t.table_schema = c.table_schema
        WHERE 
          t.table_schema = 'public'
        GROUP BY 
          t.table_name
        ORDER BY 
          t.table_name;
      `)

      return sql`
        -- Build WHERE clause from conditions
        CREATE FUNCTION build_where_clause(conditions JSON)
        RETURNS text
        LANGUAGE plpgsql
        AS $$
        DECLARE
          query text;
          condition json;
        BEGIN
          IF conditions IS NOT NULL AND json_array_length(conditions) > 0 THEN
            query := ' WHERE ';
            FOR condition IN SELECT * FROM json_array_elements(conditions)
            LOOP
              query := query || condition->>'field' || ' ' || condition->>'operator' || ' ' || quote_literal(condition->>'value') || ' AND ';
            END LOOP;
            query := left(query, -5);
          END IF;
          RETURN query;
        END;
        $$;

        ${tables.map(table => {
          if (!table.primary_key_columns.length) {
            // No primary key, skip
            return ''
          }

          const fn = (prefix: string) => sql.id(`${prefix}_${table.name}`)
          const tbl = sql.id(table.name)

          // Typed parameter list for a primary key (possibly composite)
          const pkParams = sql.join(
            ',',
            table.primary_key_columns.map(pk => [
              sql.join(' ', [
                sql.id(`p_${pk}`),
                [sql.id(table.name, pk), sql.unsafe('%TYPE')],
              ]),
            ]),
          )

          // For matching a row by the primary key parameters.
          const pkParamsMatch = sql.join(
            sql.unsafe(' AND '),
            table.primary_key_columns.map(pk =>
              sql.join(sql.unsafe(' = '), [sql.id(pk), sql.id(`p_${pk}`)]),
            ),
          )

          // List of primary key columns (e.g. for SELECT statements)
          const pkColumns = sql.join(
            ',',
            table.primary_key_columns.map(pk => sql.id(pk)),
          )

          return sql`
            -- Get a row by primary key
            CREATE FUNCTION ${fn('get')}(${pkParams})
            RETURNS ${tbl}
            LANGUAGE SQL
            AS $$
              SELECT * FROM ${tbl} WHERE ${pkParamsMatch} LIMIT 1;
            $$;

            -- List rows matching conditions
            CREATE FUNCTION ${fn('list')}(conditions JSON)
            RETURNS SETOF ${tbl}
            LANGUAGE plpgsql
            AS $$
            DECLARE
              query text;
            BEGIN
              query := 'SELECT * FROM ${tbl}' || build_where_clause(conditions);
              RETURN QUERY EXECUTE query;
            END;
            $$;

            -- Find a row by conditions
            CREATE FUNCTION ${fn('find')}(conditions JSON)
            RETURNS SETOF ${tbl}
            LANGUAGE plpgsql
            AS $$
            BEGIN
              RETURN QUERY SELECT * FROM ${fn('list')}(conditions) LIMIT 1;
            END;
            $$;

            -- Count rows matching conditions
            CREATE FUNCTION ${fn('count')}(conditions JSON)
            RETURNS bigint
            LANGUAGE plpgsql
            AS $$
            DECLARE
              query text;
              result bigint;
            BEGIN
              query := 'SELECT COUNT(*) FROM ${tbl}' || build_where_clause(conditions);
              EXECUTE query INTO result;
              RETURN result;
            END;
            $$;

            -- Insert a row
            CREATE FUNCTION ${fn('insert')}(data ${tbl})
            RETURNS ${tbl}
            LANGUAGE plpgsql
            AS $$
            BEGIN
              RETURN QUERY INSERT INTO ${tbl} SELECT * FROM data RETURNING *;
            END;
            $$;

            -- Upsert a row by primary key
            CREATE FUNCTION ${fn('upsert')}(data ${tbl})
            RETURNS ${tbl}
            LANGUAGE SQL
            AS $$
              INSERT INTO ${tbl} SELECT * FROM data
              ON CONFLICT (${pkColumns}) DO UPDATE
              SET ${sql.join(
                ',',
                table.columns.map(c => [
                  sql.id(c),
                  sql.unsafe(' = EXCLUDED.'),
                  sql.id(c),
                ]),
              )}
              RETURNING *;
            $$;

            -- Update a row by primary key
            CREATE FUNCTION ${fn('update')}(${pkParams}, data JSON)
            RETURNS ${tbl}
            LANGUAGE plpgsql
            AS $$
            DECLARE
              update_query text := 'UPDATE ${tbl} SET ';
              key text;
              value json;
            BEGIN
              FOR key, value IN SELECT * FROM json_each(data)
              LOOP
                update_query := update_query || quote_ident(key) || ' = ' || quote_nullable(value::text) || ', ';
              END LOOP;
              
              update_query := left(update_query, -2); -- Remove trailing comma and space
              update_query := update_query || ' WHERE ${pkParamsMatch} RETURNING *';
              
              RETURN QUERY EXECUTE update_query;
            END;
            $$;

            -- Replace a row by primary key
            CREATE FUNCTION ${fn('replace')}(${pkParams}, data ${tbl})
            RETURNS ${tbl}
            LANGUAGE SQL
            AS $$
              DELETE FROM ${tbl} WHERE ${pkParamsMatch};
              INSERT INTO ${tbl} SELECT * FROM data RETURNING *;
            $$;

            -- Delete a row by primary key
            CREATE FUNCTION ${fn('delete')}(${pkParams})
            RETURNS boolean
            LANGUAGE SQL
            AS $$
              DELETE FROM ${tbl} WHERE ${pkParamsMatch} RETURNING *;
            $$;
          `
        })}
      `
    },
  }
}
