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
        ${renderUtilityQueries(context)}
        ${tables.map(table => renderTableQueries(table, context, options))}
      `
    },
    generate({ namespaces }) {
      // Skip build_where_clause in the TypeScript definitions.
      namespaces.public.functions = namespaces.public.functions.filter(fn => {
        return fn.name !== 'build_where_clause'
      })
    },
  }
}

function renderUtilityQueries({ sql }: StatementsContext) {
  return sql`
    -- Build WHERE clause from conditions
    CREATE FUNCTION build_where_clause(conditions JSON)
    RETURNS text
    LANGUAGE plpgsql
    AS $$
    DECLARE
      sql text;
      condition json;
      field text;
      op text;
      val json;
    BEGIN
      IF conditions IS NOT NULL AND json_array_length(conditions) > 0 THEN
        sql := ' WHERE ';
        FOR condition IN SELECT * FROM json_array_elements(conditions)
        LOOP
          field := condition->>'field';
          op := condition->>'operator';
          val := condition->'value';

          -- Verify the operator is valid
          IF op NOT IN ('=', '<>', '>', '<', '>=', '<=', 'LIKE', 'ILIKE', 'IN', 'NOT IN', 'IS NULL', 'IS NOT NULL') THEN
            RAISE EXCEPTION 'Invalid operator: %', op;
          END IF;

          -- Handle special cases for NULL and IN operators
          IF op IN ('IS NULL', 'IS NOT NULL') THEN
            sql := sql || quote_ident(field)
                       || ' '
                       || op
                       || ' AND ';
          ELSIF op IN ('IN', 'NOT IN') THEN
            sql := sql || quote_ident(field)
                       || CASE WHEN op = 'IN' THEN ' = ANY' ELSE ' <> ALL' END
                       || '(ARRAY['
                       || array_to_string(ARRAY(
                            SELECT CASE 
                              WHEN json_typeof(v) = 'string' THEN quote_literal(v::text)
                              ELSE v::text
                            END
                            FROM json_array_elements(val) AS v
                          ), ',')
                       || ']::pg_typeof('
                       || quote_ident(field)
                       || ')[]) AND ';
          ELSE
            sql := sql || quote_ident(field)
                       || ' '
                       || op
                       || ' '
                       || CASE WHEN json_typeof(val) = 'string' THEN quote_literal(val::text) ELSE val::text END
                       || ' AND ';
          END IF;
        END LOOP;
        sql := left(sql, -5); -- Remove trailing ' AND '
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

  const pluralize =
    options.pluralize ??
    ((noun: string) => {
      return irregularPlurals[noun] ?? `${noun}s`
    })

  const fn = objectify(
    [
      ['list', true],
      ['find', false],
      ['count', true],
    ] as const,
    ([verb]) => verb,
    ([verb, plural]) => {
      const schema = table.id.schema ?? 'public'
      const name = `${verb}_${plural ? pluralize(table.id.name) : table.id.name}`
      return sql.id(schema, name)
    },
  )

  return sql`
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
  `
}
