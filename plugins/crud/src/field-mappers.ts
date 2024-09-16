import { camelToSnake, defineFieldMapper, FieldCase } from 'pg-nano'

export const update_mapper = defineFieldMapper(
  (value: Record<string, unknown>, client) => {
    const entries: unknown[] = []
    for (const key of Object.keys(value)) {
      entries.push(
        client.config.fieldCase === FieldCase.camel ? camelToSnake(key) : key,
        value[key],
      )
    }
    return entries
  },
  // Since this is only used for the updated_data parameter of an update
  // function, we don't need to map output values.
  null,
)
