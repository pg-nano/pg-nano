import { defineFieldMapper, type FieldMapper } from '../fieldMapper.js'

/**
 * Used in `typeData.ts` to define an array of values that will be mapped by a
 * field mapper.
 */
export const defineArrayMapper = (type: FieldMapper) =>
  defineFieldMapper(
    type.mapInput
      ? (input: any[], client) =>
          input.map(value => type.mapInput!(value, client))
      : null,
    type.mapOutput
      ? (input: any[], client) =>
          input.map(value => type.mapOutput!(value, client))
      : null,
  )
