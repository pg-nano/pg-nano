import { Tuple } from 'pg-native'
import { isArray, isObject } from 'radashi'
import type { Client } from '../client.js'
import { FieldMapper, type Fields, type FieldType } from './fields.js'

export type InParams = Fields | readonly FieldType[]
export type OutParams = { [name: string]: Fields | FieldMapper }

/**
 * The `prepareParams` function has two purposes:
 *
 *   1. Convert named parameters to positional parameters.
 *   2. Prepare composite types for query execution.
 */
export function prepareParams(
  client: Client,
  input: unknown,
  params: InParams,
  values?: unknown[],
) {
  // When all named parameters could be optional, passing `undefined` is
  // perfectly valid.
  if (input === undefined) {
    return []
  }

  let namedValues: Record<string, unknown> | undefined
  let names: string[] | undefined
  let types: readonly FieldType[]

  // When the params are an array, the input must be an array of values.
  if (isArray(params)) {
    types = params as readonly FieldType[]
    values = input as unknown[]
  } else {
    names = Object.keys(params)
    if (isObject(input)) {
      namedValues = input as Record<string, unknown>
    } else {
      // When the input is not a plain object, there can only be one named
      // parameter.
      namedValues = { [names[0]]: input }
    }
    types = Object.values(params)
    values = []
  }

  for (let i = types.length; --i >= 0; ) {
    const name = names?.[i]

    let value = namedValues
      ? Object.prototype.hasOwnProperty.call(namedValues, name!)
        ? namedValues[name!]
        : undefined
      : i < values.length
        ? values[i]
        : undefined

    let type = types[i]
    if (type instanceof FieldMapper) {
      if (value != null && type.mapInput) {
        value = type.mapInput(value, client)
      }
      type = type.type
    }

    if (value != null && isObject(type)) {
      if (isArray(value)) {
        value = value.map(value => {
          return prepareParams(
            client,
            value as Record<string, unknown>,
            type,
            new Tuple(),
          )
        })
      } else {
        value = prepareParams(
          client,
          value as Record<string, unknown>,
          type,
          new Tuple(),
        )
      }
    }

    if (value !== undefined) {
      values[i] = value
    } else if (i < values.length || Tuple.isTuple(values)) {
      values[i] = null
    }
  }

  return values
}
