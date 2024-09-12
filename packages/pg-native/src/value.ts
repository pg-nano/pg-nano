import { isTypedArray } from 'node:util/types'
import { Range, serialize as stringifyRange } from 'postgres-range'
import { isArray } from 'radashi'
import { Interval } from './interval'
import { Tuple } from './tuple.js'

const noEscape = <T>(x: T) => x

const objectToString = Object.prototype.toString as (this: unknown) => string

const call = <This, Args extends any[], Return>(
  fn: (this: This, ...args: Args) => Return,
  ctx: This,
  ...args: Args
): Return => fn.call(ctx, ...args)

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

export function escapeValue(value: unknown, escape: Escape = noEscape): string {
  if (value == null) {
    return 'null'
  }
  const type = typeof value
  switch (type) {
    case 'string':
      return escape(value.toString(), type)
    case 'number':
    case 'boolean':
    case 'bigint':
      return value.toString()
    case 'object': {
      let obj = value as object
      if (isArray(obj)) {
        return escape(escapeArray(obj), 'array')
      }
      switch (obj.constructor) {
        case Tuple:
          return escape(
            `(${(obj as Tuple).map(value => escapeValue(value, escape)).join(',')})`,
            'tuple',
          )
        case Interval:
          return escape((obj as Interval).toISOString(), 'interval')
        case Range:
          return escape(stringifyRange(obj as Range<any>), 'range')
      }
      switch (call(objectToString, obj).slice(8, -1)) {
        case 'Date':
          return escape((obj as Date).toISOString(), 'date')
        case 'RegExp':
          return escape((obj as RegExp).source, 'pattern')
      }
      if (isTypedArray(obj)) {
        obj = Buffer.from(obj)
      }
      if (Buffer.isBuffer(obj)) {
        return escape('\\x' + obj.toString('hex'), 'hex')
      }
      return escape(JSON.stringify(obj), 'json')
    }
  }
  throw new Error(`Unsupported type: ${type}`)
}

function escapeArray(array: any[]) {
  let sql = '{'
  for (const value of array) {
    if (sql.length > 1) {
      sql += ','
    }
    sql += escapeValue(value, escapeArrayElement)
  }
  return sql + '}'
}

const BACKSLASH_RE = /\\/g
const DOUBLE_QUOTE_RE = /"/g
const SINGLE_QUOTE_RE = /'/g

function escapeArrayElement(str: string, type: EscapedType) {
  switch (type) {
    case 'array':
    case 'hex':
    case 'tuple':
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
