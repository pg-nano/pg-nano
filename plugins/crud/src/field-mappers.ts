import { defineFieldMapper } from 'pg-nano'

// Since this is only used for the updated_data parameter of an update function,
// we don't need to map output values.
export const update_mapper = defineFieldMapper(
  (value: object) => Object.entries(value).flat(),
  null,
)
