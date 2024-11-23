import { Range } from 'postgres-range'
import { defineFieldMapper, type FieldMapper } from '../fieldMapper.js'

export function defineRangeMapper(type: FieldMapper) {
  const { mapInput, mapOutput } = type

  return defineFieldMapper(
    mapInput
      ? (input: Range<any>, client) =>
          new Range(
            mapInput(input.lower, client),
            mapInput(input.upper, client),
            (input as any).flags,
          )
      : null,
    mapOutput
      ? (input: Range<any>, client) =>
          new Range(
            mapOutput(input.lower, client),
            mapOutput(input.upper, client),
            (input as any).flags,
          )
      : null,
  )
}
