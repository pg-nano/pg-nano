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
  namedValues: Record<string, unknown> | unknown[] | undefined,
  params: Params,
  values?: unknown[],
) {
  // All named parameters may be optional, in which case, passing in `undefined`
  // is perfectly valid.
  if (!namedValues) {
    return []
  }

  let names: string[] | undefined
  let types: readonly (number | Fields)[]

  if (isArray(namedValues)) {
    types = params as readonly (number | Fields)[]
    values = namedValues
    namedValues = undefined
  } else {
    names = Object.keys(namedValues)
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
