import { isDate } from 'radashi'
import type { Input } from './input.js'

/**
 * Timestamps are represented in milliseconds (1e-3 seconds) since the Unix
 * epoch.
 *
 * Unfortunately, this could mean a loss of precision since Postgres timestamps
 * can have microseconds (1e-6 seconds). This limitation is being tracked in
 * [#48](https://github.com/pg-nano/pg-nano/issues/48).
 */
export type Timestamp = number & { __brand?: 'Timestamp' }

/**
 * Casts an input to a `Timestamp`.
 *
 * Note: This is only useful when your application server needs to patch a
 * database result using data retrieved from elsewhere. When calling a Postgres
 * routine, timestamp inputs are casted automatically.
 */
export function toTimestamp(input: Input<Timestamp>): Timestamp {
  return isDate(input) ? input.getTime() : input
}
