import type { PgTableStmt, Plugin, StatementsContext } from '@pg-nano/plugin'
import { objectify } from 'radashi'
import irregularPlurals from './irregular-plurals'

type Options = {
  pluralize?: (noun: string) => string
}

export default function (options: Options = {}): Plugin {
  return {
    name: '@pg-nano/plugin-crud',
    async statements(context) {
      const { objects, sql } = context
      const tables = objects.filter(obj => obj.type === 'table')

      return sql`
        ${renderUtilityFunctions(context)}
        ${tables.map(table => renderTableQueries(table, context, options))}
      `
    },
    generate({ namespaces }) {
      // Skip build_where_clause in the TypeScript definitions.
      namespaces.public.functions = namespaces.public.functions.filter(fn => {
        return fn.proname !== 'build_where_clause'
      })
    },
  }
}

function renderUtilityFunctions({ sql }: StatementsContext) {
  return sql`
    -- Build WHERE clause from conditions
    CREATE FUNCTION build_where_clause(conditions JSON)
    RETURNS text
    LANGUAGE plpgsql
    AS $$
    DECLARE
      sql text;
      condition json;
    BEGIN
      IF conditions IS NOT NULL AND json_array_length(conditions) > 0 THEN
      sql := ' WHERE ';
        FOR condition IN SELECT * FROM json_array_elements(conditions)
        LOOP
        sql := sql || condition->>'field' || ' ' || condition->>'operator' || ' ' || quote_literal(condition->>'value') || ' AND ';
        END LOOP;
        sql := left(sql, -5);
      END IF;
      RETURN sql;
    END;
    $$;
  `
}

function renderTableQueries(
  table: Readonly<PgTableStmt>,
  { sql }: StatementsContext,
  options: Options,
) {
  if (!table.primaryKeyColumns.length) {
    // No primary key, skip
    return ''
  }

  const tableId = table.id.toSQL()

  // Typed parameter list for a primary key (possibly composite)
  const pkParams = sql.join(
    ',',
    table.primaryKeyColumns.map(pk => [
      sql.id(`p_${pk}`),
      sql.unsafe(' '),
      sql.id(table.id.name, pk),
      sql.unsafe('%TYPE'),
    ]),
  )

  // For matching a row by the primary key parameters.
  const pkParamsMatch = sql.join(
    sql.unsafe(' AND '),
    table.primaryKeyColumns.map(pk =>
      sql.join(sql.unsafe(' = '), [sql.id(pk), sql.id(`p_${pk}`)]),
    ),
  )

  // List of primary key columns (e.g. for SELECT statements)
  const pkColumns = sql.join(
    ',',
    table.primaryKeyColumns.map(pk => sql.id(pk)),
  )

  const pluralize =
    options.pluralize ??
    ((noun: string) => {
      return irregularPlurals[noun] ?? `${noun}s`
    })

  const fn = objectify(
    [
      ['get', false],
      ['list', true],
      ['find', false],
      ['count', true],
      ['insert', false],
      ['upsert', false],
      ['update', false],
      ['replace', false],
      ['delete', false],
    ] as const,
    ([verb]) => verb,
    ([verb, plural]) => {
      const schema = table.id.schema ?? 'public'
      const name = `${verb}_${plural ? pluralize(table.id.name) : table.id.name}`
      return sql.id(schema, name)
    },
  )

  return sql`
    -- Get a row by primary key
    CREATE FUNCTION ${fn.get}(${pkParams})
    RETURNS ${tableId}
    LANGUAGE plpgsql
    AS $$
    DECLARE
      result ${tableId};
    BEGIN
      SELECT * FROM ${tableId}
        WHERE ${pkParamsMatch}
        LIMIT 1
        INTO result;
      RETURN result;
    END;
    $$;

    -- List rows matching conditions
    CREATE FUNCTION ${fn.list}(conditions JSON)
    RETURNS SETOF ${tableId}
    LANGUAGE plpgsql
    AS $$
    DECLARE
      sql text;
    BEGIN
      sql := 'SELECT * FROM ${tableId}' || build_where_clause(conditions);
      RETURN QUERY EXECUTE sql;
    END;
    $$;

    -- Find a row by conditions
    CREATE FUNCTION ${fn.find}(conditions JSON)
    RETURNS ${tableId}
    LANGUAGE plpgsql
    AS $$
    DECLARE
      result ${tableId};
    BEGIN
      SELECT * FROM ${fn.list}(conditions)
        LIMIT 1
        INTO result;
      RETURN result;
    END;
    $$;

    -- Count rows matching conditions
    CREATE FUNCTION ${fn.count}(conditions JSON)
    RETURNS bigint
    LANGUAGE plpgsql
    AS $$
    DECLARE
      sql text;
      result bigint;
    BEGIN
      sql := 'SELECT COUNT(*) FROM ${tableId}' || build_where_clause(conditions);
      EXECUTE sql INTO result;
      RETURN result;
    END;
    $$;

    -- Insert a row
    CREATE FUNCTION ${fn.insert}(rec ${tableId})
    RETURNS SETOF ${tableId}
    LANGUAGE plpgsql
    AS $$
    BEGIN
      RETURN QUERY
        INSERT INTO ${tableId} VALUES (rec.*)
        RETURNING *;
    END;
    $$;

    -- Upsert a row by primary key
    CREATE FUNCTION ${fn.upsert}(rec ${tableId})
    RETURNS ${tableId}
    LANGUAGE plpgsql
    AS $$
    DECLARE
      result ${tableId};
    BEGIN
      INSERT INTO ${tableId} VALUES (rec.*)
      ON CONFLICT (${pkColumns}) DO UPDATE
      SET ${sql.join(
        ',',
        table.columns.map(col => [
          sql.id(col.name),
          sql.unsafe(' = EXCLUDED.'),
          sql.id(col.name),
        ]),
      )}
      RETURNING * INTO result;
      RETURN result;
    END;
    $$;

    -- Update a row by primary key
    CREATE FUNCTION ${fn.update}(${pkParams}, data JSON)
    RETURNS ${tableId}
    LANGUAGE plpgsql
    AS $$
    DECLARE
      sql text := 'UPDATE ${tableId} SET ';
      key text;
      value json;
      result ${tableId};
    BEGIN
      FOR key, value IN SELECT * FROM json_each(data) LOOP
        sql := sql || quote_ident(key) || ' = ' || quote_nullable(value::text) || ', ';
      END LOOP;

      sql := left(sql, -2); -- Remove trailing comma and space
      sql := sql || ' WHERE ${pkParamsMatch} RETURNING *';

      EXECUTE sql INTO result;
      RETURN result;
    END;
    $$;

    -- Replace a row by primary key
    CREATE FUNCTION ${fn.replace}(${pkParams}, rec ${tableId})
    RETURNS ${tableId}
    LANGUAGE plpgsql
    AS $$
    DECLARE
      result ${tableId};
    BEGIN
      DELETE FROM ${tableId} WHERE ${pkParamsMatch};
      INSERT INTO ${tableId} VALUES (rec.*) RETURNING * INTO result;
      RETURN result;
    END;
    $$;

    -- Delete a row by primary key
    CREATE FUNCTION ${fn.delete}(${pkParams})
    RETURNS boolean
    LANGUAGE plpgsql
    AS $$
    DECLARE
      rows_affected integer;
    BEGIN
      WITH deleted AS (
        DELETE FROM ${tableId}
        WHERE ${pkParamsMatch}
        RETURNING *
      )
      SELECT COUNT(*) INTO rows_affected FROM deleted;
      RETURN rows_affected > 0;
    END;
    $$;
  `
}
