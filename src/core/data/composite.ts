import { getTypeParser, type Result } from 'pg-native'
import { parse as parseValues } from 'postgres-composite'
import { isArray, isObject } from 'radashi'
import type { Fields } from './fields.js'

export function parseCompositeFields(
  result: Result,
  fields: { [name: string]: Fields },
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
  type: Fields,
) {
  // The value may be an array of unparsed objects.
  return isArray(value)
    ? value.map(item => parseTuple(item, type))
    : value != null
      ? parseTuple(value, type)
      : value
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
