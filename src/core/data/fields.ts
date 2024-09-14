/**
 * A runtime map of field names to their type OIDs. Currently, this data is only
 * used for parsing/serializing composite types.
 */
export type Fields = { [name: string]: FieldType }

export type FieldType = number | Fields | FieldMapper<any, any>

export class FieldMapper<JsType = unknown, PgType = unknown> {
  private constructor(
    readonly type: number | Fields,
    readonly mapInput: ((value: JsType) => PgType) | null,
    readonly mapOutput: ((value: PgType) => JsType) | null,
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
  mapInput: (value: JsType) => PgType,
  mapOutput: null,
): (type: number | Fields) => FieldMapper<JsType, PgType>

export function defineFieldMapper<JsType = unknown, PgType = unknown>(
  mapInput: null,
  mapOutput: (value: PgType) => JsType,
): (type: number | Fields) => FieldMapper<JsType, PgType>

export function defineFieldMapper<JsType = unknown, PgType = unknown>(
  mapInput: (value: JsType) => NoInfer<PgType>,
  mapOutput: (value: PgType) => NoInfer<JsType>,
): (type: number | Fields) => FieldMapper<JsType, PgType>

export function defineFieldMapper<JsType = unknown, PgType = unknown>(
  mapInput: ((value: JsType) => PgType) | null,
  mapOutput: ((value: PgType) => JsType) | null,
): (type: number | Fields) => FieldMapper<JsType, PgType> {
  return type => new (FieldMapper as any)(type, mapInput, mapOutput)
}
