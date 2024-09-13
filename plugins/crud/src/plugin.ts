import type { PgTableStmt, Plugin, StatementsContext } from '@pg-nano/plugin'
import { objectify } from 'radashi'

export default function (): Plugin {
  return {
    name: '@pg-nano/plugin-crud',
    async statements(context) {
      const { objects, sql } = context
      const tables = objects.filter(obj => obj.kind === 'table')

      return sql`
        ${sql.join(
          sql.unsafe('\n'),
          tables.map(table => renderTableQueries(table, context)),
        )}
      `
    },
  }
}

function renderTableQueries(
  table: Readonly<PgTableStmt>,
  { sql }: StatementsContext,
) {
  if (!table.primaryKeyColumns.length) {
    console.warn(
      'Table %s has no primary key, skipping',
      table.id.toQualifiedName(),
    )
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
      sql.join(sql.unsafe(' = '), [sql.id(pk), sql.unsafe(`p_${pk}`)]),
    ),
  )

  // List of primary key columns (e.g. for SELECT statements)
  const pkColumns = sql.join(
    ',',
    table.primaryKeyColumns.map(pk => sql.id(pk)),
  )

  const fn = objectify(
    ['get', 'create', 'upsert', 'update', 'replace', 'delete'] as const,
    verb => verb,
    verb => {
      const schema = table.id.schema ?? 'public'
      const name = `${verb}_${table.id.name}`
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

    -- Insert a new row
    CREATE FUNCTION ${fn.create}(${tableId})
    RETURNS SETOF ${tableId}
    LANGUAGE plpgsql
    AS $$
    BEGIN
      RETURN QUERY
        INSERT INTO ${tableId} VALUES ($1.*)
        RETURNING *;
    END;
    $$;

    -- Upsert a row by primary key
    CREATE FUNCTION ${fn.upsert}(${tableId})
    RETURNS ${tableId}
    LANGUAGE plpgsql
    AS $$
    DECLARE
      result ${tableId};
    BEGIN
      INSERT INTO ${tableId} VALUES ($1.*)
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
