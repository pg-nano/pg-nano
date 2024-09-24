import type { Row } from 'pg-native'
import type { Client } from '../client.js'
import { FieldMapper, type FieldType, type Fields } from './fields.js'

const hasOwnProperty = Object.prototype.hasOwnProperty

export type OutParams = { [name: string]: Fields | FieldMapper }

export function prepareOutParam(
  client: Client,
  value: unknown,
  type: FieldType,
) {
  if (type instanceof FieldMapper) {
    if (type.type) {
      prepareOutParam(client, value, type.type)
    }
    if (type.mapOutput) {
      return type.mapOutput(value, client)
    }
  } else if (type) {
    const row = value as Row
    for (const fieldName in type) {
      const value = row[fieldName]
      if (value !== null) {
        prepareOutParam(client, value, type[fieldName])
      }
    }
  }
  return value
}
