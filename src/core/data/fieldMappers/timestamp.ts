import { isNumber } from 'radashi'
import { defineFieldMapper } from '../fieldMapper.js'

/**
 * Used in `typeData.ts` to allow a `number` or `Date` JavaScript type to be
 * passed where a `timestamptz` or `timestamp` Postgres type is expected.
 */
export const TimestampInput = defineFieldMapper(
  (input: number | Date) => (isNumber(input) ? new Date(input) : input),
  null,
)
