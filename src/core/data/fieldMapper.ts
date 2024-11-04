import { stringifyValue, Tuple } from 'pg-native'
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

export type RowMapper = FieldMapper<Record<string, unknown>, Tuple> & {
  keys: string[]
}

/**
 * Used in `typeData.ts` to define the fields of a row type (AKA composite
 * types), which is represented as a tuple in Postgres. This is necessary to
 * ensure the fields are serialized in the correct order.
 */
export function defineRowMapper(
  keys: string[],
  inputMappers?: Record<string, FieldMapper>,
): RowMapper {
  const mapper = defineFieldMapper((input: Record<string, unknown>, client) => {
    const values = new Tuple()
    for (let i = 0, key: string, value: unknown; i < keys.length; i++) {
      key = keys[i]
      value = Object.prototype.hasOwnProperty.call(input, key)
        ? input[key]
        : undefined

      const type = inputMappers?.[key]
      if (type?.mapInput && value != null) {
        value = type.mapInput(value, client)
      }

      values[i] = value !== undefined ? value : null
    }
    return values
  }, null) as RowMapper

  mapper.keys = keys
  return mapper
}

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
