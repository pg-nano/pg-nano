import {
  type ColumnDef,
  type Constraint,
  ConstrType,
  type PgColumnDef,
  type PgObject,
  PgObjectType,
  PgParamKind,
  type PgRoutine,
  type PgTableStmt,
  type Plugin,
  sql,
  type SQLIdentifier,
  type SQLTemplateValue,
} from 'pg-nano/plugin'
import { isString, objectify } from 'radashi'

export default function (): Plugin {
  return {
    name: '@pg-nano/plugin-crud',
    async statements(context) {
      const { objects } = context
      const tables = objects.filter(obj => obj.kind === 'table')

      const isRoutineWithPrefix = (
        container: Readonly<PgObject>,
        prefix: string | RegExp,
      ): container is Readonly<PgRoutine> =>
        container.plugin === this &&
        container.type === PgObjectType.Routine &&
        (isString(prefix)
          ? container.name.startsWith(prefix)
          : prefix.test(container.name))

      this.generateStart = ({ routines }) => {
        for (const routine of routines) {
          if (isRoutineWithPrefix(routine, 'update_')) {
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
          isRoutineWithPrefix(container, 'update_') &&
          paramKind === PgParamKind.In &&
          paramIndex === container.paramTypes.length - 1
        ) {
          return {
            lang: 'ts',
            type: `Partial<${renderTypeReference(container.returnTypeOid, PgParamKind.Out)}>`,
          }
        }
        if (
          isRoutineWithPrefix(container, 'create_') &&
          paramKind === PgParamKind.In
        ) {
          return {
            lang: 'ts',
            type: renderTypeReference(container.returnTypeOid, PgParamKind.In),
          }
        }
        if (
          isRoutineWithPrefix(container, 'upsert_') &&
          paramKind === PgParamKind.In
        ) {
          return {
            lang: 'ts',
            type: `${renderTypeReference(container.returnTypeOid, PgParamKind.Out)}.UpsertParams`,
          }
        }
      }

      this.mapField = ({ paramKind, paramIndex = -1, container }) => {
        if (
          isRoutineWithPrefix(container, 'update_') &&
          paramKind === PgParamKind.In &&
          paramIndex === container.paramTypes.length - 1
        ) {
          return {
            name: 'update_mapper',
            path: '@pg-nano/plugin-crud/field-mappers',
          }
        }
        if (isRoutineWithPrefix(container, /^(create_|upsert_)/)) {
          return {
            name: 'insert_mapper',
            args: 't.' + container.name.replace(/^(create_|upsert_)/, ''),
            path: '@pg-nano/plugin-crud/field-mappers',
          }
        }
      }

      return sql`
        ${sql.join('\n', tables.map(renderTableQueries))}
      `
    },
  }
}

function isSerialType(id: SQLIdentifier) {
  return id.name === 'serial' && !id.schema
}

function castColumnFromText(
  value: SQLTemplateValue,
  col: PgColumnDef<ColumnDef>,
) {
  const type = col.type
  // Since the value being casted is a "text" type, we don't need to cast it
  // when the column type is also "text".
  if (
    !type.arrayBounds &&
    type.name === 'text' &&
    type.schema === 'pg_catalog'
  ) {
    return value
  }
  // The "serial" column type is a pseudo type, so we need to cast to "int",
  // which is the real type that it maps to.
  if (isSerialType(type)) {
    return sql`${value}::int`
  }
  return sql`${value}::${type.toSQL()}`
}

function findConstraint(
  col: PgColumnDef<ColumnDef>,
  match: (con: Constraint) => boolean,
) {
  if (col.node.constraints) {
    for (const con of col.node.constraints) {
      if (match(con.Constraint)) {
        return con.Constraint
      }
    }
  }
}

function arrayAccess(array: SQLTemplateValue, index: number) {
  return sql`${array}[${sql.unsafe(String(index + 1))}]`
}

function renderTableQueries(table: Readonly<PgTableStmt>) {
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

  const columnsExceptPKs = table.columns.filter(
    col => !table.primaryKeyColumns.includes(col.name),
  )

  const columnsWithDefault = table.columns.filter(
    col =>
      isSerialType(col.type) ||
      findConstraint(
        col,
        con =>
          con.contype === ConstrType.CONSTR_GENERATED ||
          con.contype === ConstrType.CONSTR_DEFAULT,
      ),
  )

  const columnsWithDefaultNotAlwaysGenerated = columnsWithDefault.filter(
    col =>
      !findConstraint(
        col,
        con =>
          con.contype === ConstrType.CONSTR_GENERATED &&
          con.generated_when === 'a',
      ),
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

  let updateRoutine: SQLTemplateValue = ''

  if (columnsExceptPKs.length) {
    updateRoutine = sql`
      -- Update a row by primary key
      CREATE FUNCTION ${fn.update}(${pkParams}, updated_data text[])
      RETURNS ${tableId}
      LANGUAGE plpgsql
      AS $$
      DECLARE
        _ctid tid;
        _result ${tableId};
      BEGIN
        SELECT ctid FROM ${tableId}
        WHERE ${pkParamsMatch}
        LIMIT 1
        INTO _ctid;

        SELECT * FROM ${tableId}
        WHERE ctid = _ctid
        LIMIT 1
        INTO _result
        FOR UPDATE;

        FOR i IN 1..array_upper(updated_data, 1) BY 2 LOOP
          CASE updated_data[i]
          ${columnsExceptPKs.map(col => {
            return sql`WHEN ${sql.val(col.name)} THEN _result.${sql.id(col.name)} := ${castColumnFromText(sql.unsafe('updated_data[i + 1]'), col)};\n`
          })}
          ELSE
            RAISE EXCEPTION 'Unknown column: %', updated_data[i];
          END CASE;
        END LOOP;

        UPDATE ${tableId}
        SET ${sql.join(
          sql.unsafe(', '),
          columnsExceptPKs.map(col => [
            sql.id(col.name),
            sql.unsafe(' = _result.'),
            sql.id(col.name),
          ]),
        )}
        WHERE ctid = _ctid;

        RETURN _result;
      END;
      $$;
    `
  }

  return sql`
    ${updateRoutine}
  
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
    CREATE FUNCTION ${fn.create}(text[])
    RETURNS ${tableId}
    LANGUAGE plpgsql
    AS $$
    DECLARE
      _ctid tid;
      _result ${tableId};
    BEGIN
      INSERT INTO ${tableId} VALUES (${sql.join(
        sql.unsafe(', '),
        table.columns.map((col, index) => {
          if (columnsWithDefault.includes(col)) {
            // Use the default value for now. We'll check if the given value is
            // non-null and update the record if it is. Sadly, we can't use the
            // DEFAULT keyword in a conditional expression.
            return sql.unsafe('DEFAULT')
          }
          return castColumnFromText(arrayAccess(sql.unsafe('$1'), index), col)
        }),
      )})
      ${
        columnsWithDefaultNotAlwaysGenerated.length > 0
          ? sql`RETURNING ctid INTO _ctid`
          : sql`RETURNING * INTO _result`
      };

      ${
        columnsWithDefaultNotAlwaysGenerated.length > 0
          ? sql`
              UPDATE ${table.id.toSQL()}
              SET ${sql.join(
                sql.unsafe(', '),
                columnsWithDefaultNotAlwaysGenerated.map(col => {
                  const index = table.columns.indexOf(col)
                  const column = sql.id(col.name)
                  const givenValue = castColumnFromText(
                    arrayAccess(sql.unsafe('$1'), index),
                    col,
                  )

                  return sql`${column} = COALESCE(${givenValue}, ${column})`
                }),
              )}
              WHERE ctid = _ctid
              RETURNING *
              INTO _result;
            `
          : ''
      }

      RETURN _result;
    END;
    $$;

    -- Upsert a row by primary key
    CREATE FUNCTION ${fn.upsert}(text[])
    RETURNS ${tableId}
    LANGUAGE plpgsql
    AS $$
    DECLARE
      _ctid tid;
      _result ${tableId};
    BEGIN
      SELECT ctid FROM ${tableId}
      WHERE ${sql.join(
        sql.unsafe(' AND '),
        table.primaryKeyColumns.map(pk => {
          const index = table.columns.findIndex(col => col.name === pk)

          return sql`${sql.id(pk)} = ${castColumnFromText(
            arrayAccess(sql.unsafe('$1'), index),
            table.columns[index],
          )}`
        }),
      )}
      LIMIT 1
      INTO _ctid
      FOR UPDATE;

      IF FOUND THEN
        DELETE FROM ${tableId} WHERE ctid = _ctid;
      END IF;

      SELECT * FROM ${fn.create}($1) INTO _result;
      RETURN _result;
    END;
    $$;

    -- Delete a row by primary key
    CREATE FUNCTION ${fn.delete}(${pkParams})
    RETURNS boolean
    LANGUAGE plpgsql
    AS $$
    BEGIN
      DELETE FROM ${tableId}
      WHERE ${pkParamsMatch};
      RETURN FOUND;
    END;
    $$;
  `
}
