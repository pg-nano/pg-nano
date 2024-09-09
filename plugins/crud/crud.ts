import type { Plugin, QueriesContext } from '@pg-nano/plugin'

export default function (): Plugin {
  return {
    name: '@pg-nano/plugin-crud',
    async queries(context) {
      const { client, sql } = context
      const tables = await client.queryRows<PgTable>(sql`
        SELECT
          t.relname AS name,
          array_agg(a.attname) FILTER (WHERE a.attnum = ANY(conkey)) AS primary_key_columns,
          array_agg(DISTINCT a.attname) AS columns
        FROM
          pg_class t
        JOIN
          pg_namespace n ON t.relnamespace = n.oid
        LEFT JOIN
          pg_constraint c ON c.conrelid = t.oid AND c.contype = 'p'
        LEFT JOIN
          pg_attribute a ON a.attrelid = t.oid
        WHERE
          n.nspname = 'public'
          AND t.relkind = 'r'
          AND a.attnum > 0
          AND NOT a.attisdropped
        GROUP BY
          t.relname
        ORDER BY
          t.relname;
      `)

      return sql`
        ${renderUtilityFunctions(context)}
        ${tables.map(table => renderTableQueries(table, context))}
      `
    },
  }
}

function renderUtilityFunctions({ sql }: QueriesContext) {
  return sql`
    -- Build WHERE clause from conditions
    CREATE FUNCTION build_where_clause(conditions JSON)
    RETURNS text
    LANGUAGE plpgsql
    AS $$
    DECLARE
      where_clause text;
      condition json;
    BEGIN
      IF conditions IS NOT NULL AND json_array_length(conditions) > 0 THEN
      where_clause := ' WHERE ';
        FOR condition IN SELECT * FROM json_array_elements(conditions)
        LOOP
        where_clause := where_clause || condition->>'field' || ' ' || condition->>'operator' || ' ' || quote_literal(condition->>'value') || ' AND ';
        END LOOP;
        where_clause := left(where_clause, -5);
      END IF;
      RETURN where_clause;
    END;
    $$;
  `
}

type PgTable = {
  name: string
  primary_key_columns: string[]
  columns: string[]
}

function renderTableQueries(table: PgTable, { sql }: QueriesContext) {
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
      sql.id(`p_${pk}`),
      sql.unsafe(' '),
      sql.id(table.name, pk),
      sql.unsafe('%TYPE'),
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
    RETURNS SETOF ${tbl}
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
}
