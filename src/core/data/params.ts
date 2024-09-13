import { Tuple } from 'pg-native'
import { isArray, isObject } from 'radashi'
import type { Fields } from './fields.js'

export type Params = Fields | readonly (number | Fields)[]

/**
 * The `prepareParams` function has two purposes:
 *
 *   1. Convert named parameters to positional parameters.
 *   2. Prepare composite types for query execution.
 */
export function prepareParams(
  input: unknown,
  params: Params | null | undefined,
  values?: unknown[],
) {
  // When all named parameters could be optional, passing `undefined` is
  // perfectly valid.
  if (input === undefined) {
    return []
  }
  if (!params) {
    // If there are no params, the input must be an array of values.
    return input as unknown[]
  }

  let namedValues: Record<string, unknown> | undefined
  let names: string[] | undefined
  let types: readonly (number | Fields)[]

  // When the params are an array, the input must be an array of values.
  if (isArray(params)) {
    types = params as readonly (number | Fields)[]
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
    const type = types[i]

    let value = namedValues
      ? Object.prototype.hasOwnProperty.call(namedValues, name!)
        ? namedValues[name!]
        : undefined
      : i < values.length
        ? values[i]
        : undefined

    if (isObject(type)) {
      value &&= isArray(value)
        ? value.map(object => {
            // The value is an array of objects.
            return prepareParams(
              object as Record<string, unknown>,
              type,
              new Tuple(),
            )
          })
        : prepareParams(value as Record<string, unknown>, type, new Tuple())
    }

    if (value !== undefined) {
      values[i] = value
    } else if (i < values.length || Tuple.isTuple(values)) {
      values[i] = null
    }
  }

  return values
}
