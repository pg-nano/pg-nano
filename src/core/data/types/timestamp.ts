/**
 * Timestamps are represented in milliseconds (1e-3 seconds) since the Unix
 * epoch.
 *
 * Unfortunately, this could mean a loss of precision since Postgres timestamps
 * can have microseconds (1e-6 seconds). This limitation is being tracked in
 * [#48](https://github.com/pg-nano/pg-nano/issues/48).
 */
export type Timestamp = number & { __brand?: 'Timestamp' }
