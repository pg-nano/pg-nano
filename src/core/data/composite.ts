import { getTypeParser, type Result } from 'pg-native'
import { parse as parseValues } from 'postgres-composite'
import { isArray, isObject } from 'radashi'
import { FieldMapper, type Fields } from './fields.js'

export function parseCompositeFields(
  result: Result,
  fields: { [name: string]: Fields | FieldMapper },
) {
  for (const name in fields) {
    const type = fields[name]

    for (const row of result.rows) {
      row[name] = parseCompositeField(row[name] as any, type)
    }
  }
}

function parseCompositeField(
  value: string[] | string | null | undefined,
  type: Fields | FieldMapper,
) {
  if (value == null) {
    return value
  }

  let mapOutput: ((value: unknown) => unknown) | null = null
  if (type instanceof FieldMapper) {
    mapOutput = type.mapOutput
    type = type.type as Fields
  }

  // The value may be an array of unparsed objects.
  if (isArray(value)) {
    return value.map(str => {
      const result = parseTuple(str, type)
      return mapOutput ? mapOutput(result) : result
    })
  }

  const result = parseTuple(value, type)
  return mapOutput ? mapOutput(result) : result
}

function parseTuple(rawValue: string, fields: Fields) {
  const result: Record<string, unknown> = {}
  const names = Object.keys(fields)

  let index = 0
  for (const value of parseValues(rawValue)) {
    const name = names[index++]
    const type = fields[name]

    // If `type` is an object, we have a composite type that depends on another
    // composite type for one of its fields.
    result[name] =
      value != null
        ? isObject(type)
          ? parseCompositeField(value, type)
          : getTypeParser(type)(value)
        : value
  }

  return result
}
