import {
  camelToSnake,
  defineFieldMapper,
  FieldCase,
  snakeToCamel,
  toPostgresText,
  type RowMapper,
} from 'pg-nano'

export const insert_mapper = (table: RowMapper) =>
  defineFieldMapper(
    (input: Record<string, unknown>, client) => {
      const values: unknown[] = []
      for (let i = table.keys.length, key: string, value: unknown; --i >= 0; ) {
        key = table.keys[i]
        if (client.config.fieldCase === FieldCase.camel) {
          key = snakeToCamel(key)
        }

        value = Object.prototype.hasOwnProperty.call(input, key)
          ? input[key]
          : undefined

        if (value !== undefined) {
          values[i] = toPostgresText(value)
        } else if (i < values.length) {
          values[i] = null
        }
      }
      return values
    },
    // Not an output mapper.
    null,
  )

export const update_mapper = defineFieldMapper(
  (input: Record<string, unknown>, client) => {
    const entries: unknown[] = []
    for (const key of Object.keys(input)) {
      const value = input[key]
      if (value !== undefined) {
        entries.push(
          client.config.fieldCase === FieldCase.camel ? camelToSnake(key) : key,
          toPostgresText(value),
        )
      }
    }
    return entries
  },
  // Not an output mapper.
  null,
)
