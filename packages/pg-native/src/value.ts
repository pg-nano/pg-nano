import { isTypedArray } from 'node:util/types'
import Interval from 'postgres-interval'
import { Range, serialize as stringifyRange } from 'postgres-range'
import { isFunction } from 'radashi'
import { Tuple } from './tuple.js'

const noEscape = <T>(x: T) => x

type Escape = (value: string, type: EscapedType) => string
type EscapedType =
  | 'array'
  | 'date'
  | 'interval'
  | 'hex'
  | 'json'
  | 'pattern'
  | 'range'
  | 'string'
  | 'tuple'

export function stringifyValue(
  value: unknown,
  escape: Escape = noEscape,
): string {
  if (value == null) {
    return 'null'
  }
  const type = typeof value
  switch (type) {
    case 'string':
      return escape(value as string, type)
    case 'number':
    case 'boolean':
    case 'bigint':
      return value.toString()
    case 'object': {
      let obj = value as object
      switch (obj.constructor) {
        case Array:
          return escape(stringifyArray(obj as any[]), 'array')
        case Tuple:
          return escape(
            `(${(obj as Tuple)
              .map(value => {
                if (value === null) {
                  return ''
                }
                return stringifyValue(value, escape)
              })
              .join(',')})`,
            'tuple',
          )
        case Interval:
          return escape((obj as Interval).toISOStringShort(), 'interval')
        case Range:
          return escape(stringifyRange(obj as Range<any>), 'range')
        case Date:
          return escape((obj as Date).toISOString(), 'date')
        case RegExp:
          return escape((obj as RegExp).source, 'pattern')
      }
      if (isTypedArray(obj)) {
        obj = Buffer.from(obj)
      }
      if (Buffer.isBuffer(obj)) {
        return escape('\\x' + obj.toString('hex'), 'hex')
      }
      if (canJsonStringify(obj)) {
        return escape(JSON.stringify(obj), 'json')
      }
    }
  }
  throw new Error(`Unsupported type: ${type}`)
}

function canJsonStringify(obj: any): obj is { toJSON: () => string } {
  return (
    obj.constructor === Object ||
    (Object.prototype.hasOwnProperty.call(obj, 'toJSON') &&
      isFunction(obj.toJSON))
  )
}

function stringifyArray(array: any[]) {
  let sql = '{'
  for (const value of array) {
    if (sql.length > 1) {
      sql += ','
    }
    sql += stringifyValue(value, stringifyArrayElement)
  }
  return sql + '}'
}

const BACKSLASH_RE = /\\/g
const DOUBLE_QUOTE_RE = /"/g
const SINGLE_QUOTE_RE = /'/g

function stringifyArrayElement(str: string, type: EscapedType) {
  switch (type) {
    case 'array':
    case 'hex':
      return str
    case 'json':
      return (
        "'" +
        str.replace(BACKSLASH_RE, '\\\\').replace(SINGLE_QUOTE_RE, "\\'") +
        "'"
      )
  }
  return (
    '"' +
    str.replace(BACKSLASH_RE, '\\\\').replace(DOUBLE_QUOTE_RE, '\\"') +
    '"'
  )
}
