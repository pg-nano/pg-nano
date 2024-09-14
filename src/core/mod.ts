export * from './client.js'
export * from './data/types.js'
export * from './error.js'
export * from './query.js'

export {
  FieldCase,
  Interval,
  PgNativeError,
  PgResultError,
  Range,
  buildResult,
  isPgResultError,
  snakeToCamel,
  sql,
  type Field,
  type IntervalParts,
  type QueryHook,
  type Result,
  type Row,
  type SQLTemplate,
  type SQLTemplateValue,
  type SQLToken,
} from 'pg-native'

// Plugin APIs
export {
  FieldMapper,
  defineFieldMapper,
} from './data/fields.js'

/** @internal */
export * from './routines.js'
