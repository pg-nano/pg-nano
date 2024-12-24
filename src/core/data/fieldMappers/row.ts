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
    const { mapFieldName } = client
    const values = new Tuple()
    for (let i = 0; i < keys.length; i++) {
      const key = mapFieldName ? mapFieldName(keys[i]) : keys[i]
      const value = Object.prototype.hasOwnProperty.call(input, key)
        ? input[key]
        : undefined

      if (value == null) {
        values[i] = null
      } else {
        const type = inputMappers?.[keys[i]]
        values[i] = type?.mapInput ? type.mapInput(value, client) : value
      }
    }
    return values
  }, null) as RowMapper

  mapper.keys = keys
  return mapper
}
