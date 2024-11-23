import { stringifyValue } from 'pg-native'
import { isString } from 'radashi'
import type { Client } from '../client.js'

export class FieldMapper<JsType = any, PgType = any> {
  private constructor(
    readonly mapInput: ((value: JsType, client: Client) => PgType) | null,
    readonly mapOutput: ((value: PgType, client: Client) => JsType) | null,
  ) {}
}

type NoInfer<T> = [T][T extends any ? 0 : never]

/**
 * Plugins use this to define a “field mapper”, an object that performs type
 * conversion to ensure a field's data is what it's expected to be on both ends
 * of the connection.
 *
 * Field mappers are applied through the `mapField` plugin hook.
 *
 * One use case is where a plugin generates a Postgres function that requires a
 * JSON type to work, but the data can be more specific on the TypeScript end,
 * because the plugin knows better.
 */
export function defineFieldMapper<JsType = unknown, PgType = unknown>(
  mapInput: (value: JsType, client: Client) => PgType,
  mapOutput: null,
): FieldMapper<JsType, PgType>

export function defineFieldMapper<JsType = unknown, PgType = unknown>(
  mapInput: null,
  mapOutput: (value: PgType, client: Client) => JsType,
): FieldMapper<JsType, PgType>

export function defineFieldMapper<JsType = unknown, PgType = unknown>(
  mapInput: (value: JsType, client: Client) => NoInfer<PgType>,
  mapOutput: (value: PgType, client: Client) => NoInfer<JsType>,
): FieldMapper<JsType, PgType>

export function defineFieldMapper<JsType = unknown, PgType = unknown>(
  mapInput: ((value: JsType, client: Client) => PgType) | null,
  mapOutput: ((value: PgType, client: Client) => JsType) | null,
): FieldMapper<JsType, PgType>

export function defineFieldMapper<JsType = unknown, PgType = unknown>(
  mapInput: ((value: JsType, client: Client) => PgType) | null,
  mapOutput: ((value: PgType, client: Client) => JsType) | null,
): FieldMapper<JsType, PgType> {
  return new (FieldMapper as any)(mapInput, mapOutput)
}

/**
 * Convert any value into its Postgres text representation, except for strings
 * and nullish values, which are returned as-is.
 *
 * Plugins may use this function in their field mappers to generate a
 * `TEXT`-compatible literal that can be casted to the intended type within
 * their Postgres functions. This helps with implementing polymorphic behavior.
 */
export function toPostgresText(value: unknown): string | null | undefined {
  return value == null || isString(value) ? value : stringifyValue(value)
}
