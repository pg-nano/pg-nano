import { Tuple } from 'pg-native'
import { defineFieldMapper, type FieldMapper } from '../fieldMapper.js'

export type RowMapper = FieldMapper<Record<string, unknown>, Tuple> & {
  keys: string[]
}

/**
 * Used in `typeData.ts` to define the fields of a row type (AKA composite
 * types), which is represented as a tuple in Postgres. This is necessary to
 * ensure the fields are serialized in the correct order.
 */
export function defineRowMapper(
  keys: string[],
  inputMappers?: Record<string, FieldMapper>,
): RowMapper {
  const mapper = defineFieldMapper((input: Record<string, unknown>, client) => {
    const values = new Tuple()
    for (let i = 0, key: string, value: unknown; i < keys.length; i++) {
      key = keys[i]
      value = Object.prototype.hasOwnProperty.call(input, key)
        ? input[key]
        : undefined

      const type = inputMappers?.[key]
      if (type?.mapInput && value != null) {
        value = type.mapInput(value, client)
      }

      values[i] = value !== undefined ? value : null
    }
    return values
  }, null) as RowMapper

  mapper.keys = keys
  return mapper
}
