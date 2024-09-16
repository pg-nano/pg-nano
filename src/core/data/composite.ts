import { getTypeParser, type Result } from 'pg-native'
import { parse as parseValues } from 'postgres-composite'
import { isArray, isObject } from 'radashi'
import type { Client } from '../client.js'
import { FieldMapper, type Fields } from './fields.js'

export function parseCompositeFields(
  client: Client,
  result: Result,
  fields: { [name: string]: Fields | FieldMapper },
) {
  for (const name in fields) {
    const type = fields[name]

    for (const row of result.rows) {
      row[name] = parseCompositeField(client, row[name] as any, type)
    }
  }
}

function parseCompositeField(
  client: Client,
  value: string[] | string | null | undefined,
  type: Fields | FieldMapper,
) {
  if (value == null) {
    return value
  }

  let mapOutput: ((value: unknown, client: Client) => unknown) | null = null
  if (type instanceof FieldMapper) {
    mapOutput = type.mapOutput
    type = type.type as Fields
  }

  // The value may be an array of unparsed objects.
  if (isArray(value)) {
    return value.map(str => {
      const result = parseTuple(client, str, type)
      return mapOutput ? mapOutput(result, client) : result
    })
  }

  const result = parseTuple(client, value, type)
  return mapOutput ? mapOutput(result, client) : result
}

function parseTuple(client: Client, rawValue: string, fields: Fields) {
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
          ? parseCompositeField(client, value, type)
          : getTypeParser(type)(value)
        : value
  }

  return result
}
