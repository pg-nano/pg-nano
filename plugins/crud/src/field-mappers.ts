import { camelToSnake, defineFieldMapper } from 'pg-nano'

// Since this is only used for the updated_data parameter of an update function,
// we don't need to map output values.
export const update_mapper = defineFieldMapper((value: object) => {
  const entries: any[] = []
  for (const key of Object.keys(value)) {
    // TODO: get the fieldCase from the client instance?
    entries.push(camelToSnake(key), (value as any)[key])
  }
  return entries
}, null)
