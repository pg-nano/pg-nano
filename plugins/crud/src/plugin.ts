import {
  PgObjectType,
  PgParamKind,
  type PgTableStmt,
  type Plugin,
  type StatementsContext,
} from '@pg-nano/plugin'
import { objectify } from 'radashi'

export default function (): Plugin {
  return {
    name: '@pg-nano/plugin-crud',
    async statements(context) {
      const { objects, sql } = context
      const tables = objects.filter(obj => obj.kind === 'table')

      this.generateStart = ({ routines }) => {
        for (const routine of routines) {
          if (routine.plugin === this && routine.name.startsWith('update_')) {
            // Remove named parameters from update routines.
            routine.paramNames = null
          }
        }
      }

      this.mapTypeReference = ({
        container,
        paramIndex,
        paramKind,
        renderTypeReference,
      }) => {
        if (
          container.plugin !== this ||
          container.type !== PgObjectType.Routine ||
          !container.name.startsWith('update_')
        ) {
          return null
        }
        if (
          paramKind === PgParamKind.In &&
          paramIndex === container.paramTypes.length - 1
        ) {
          return {
            lang: 'ts',
            type: `Partial<${renderTypeReference(container.returnTypeOid, PgParamKind.Out)}>`,
          }
        }
      }

      this.mapField = ({ fieldName, container }) => {
        if (
          container.plugin !== this ||
          container.type !== PgObjectType.Routine
        ) {
          return null
        }
        if (container.name.startsWith('update_') && fieldName === '$2') {
          return {
            name: 'update_mapper',
            path: '@pg-nano/plugin-crud/field-mappers',
          }
        }
      }

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
    CREATE FUNCTION ${fn.update}(${pkParams}, updated_data text[])
    RETURNS ${tableId}
    LANGUAGE plpgsql
    AS $$
    DECLARE
      entry_key text;
      entry_value text;
      result ${tableId};
    BEGIN
      SELECT * FROM ${tableId} WHERE ${pkParamsMatch} INTO result;

      FOR i IN 1..array_upper(updated_data, 1) BY 2 LOOP
        entry_key := updated_data[i];
        entry_value := updated_data[i + 1];

        CASE entry_key
        ${table.columns.map(col => {
          return sql`WHEN ${sql.val(col.name)} THEN result.${sql.id(col.name)} := CAST(entry_value AS ${col.type.toSQL()});\n`
        })}
        ELSE
          RAISE EXCEPTION 'Unknown column: %', entry_key;
        END CASE;
      END LOOP;
      
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
