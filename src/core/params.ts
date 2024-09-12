import { Tuple } from 'pg-native'
import { isObject } from 'radashi'

export type ParamDef = string | TupleParamDef
export type TupleParamDef = { [name: string]: ParamDef[] }

export function arrifyParams(
  params: Record<string, unknown>,
  paramDefs: ParamDef[],
  values: unknown[] = [],
) {
  for (let i = paramDefs.length; --i >= 0; ) {
    const def = paramDefs[i]

    let name: string
    let value: unknown

    if (isObject(def)) {
      name = firstKey(def)
      if (Object.prototype.hasOwnProperty.call(params, name)) {
        value = params[name]
        value &&= arrifyParams(
          value as Record<string, unknown>,
          def[name],
          new Tuple(),
        )
      }
    } else if (Object.prototype.hasOwnProperty.call(params, def)) {
      value = params[def]
    }

    if (value !== undefined) {
      values[i] = value
    } else if (values.length || Tuple.isTuple(values)) {
      values[i] = null
    }
  }

  return values
}

function firstKey(obj: object) {
  for (const key in obj) {
    return key
  }
  throw new Error('Invalid parameter definition')
}
