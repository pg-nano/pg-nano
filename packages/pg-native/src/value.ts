import { isTypedArray } from 'node:util/types'
import { Range, serialize as stringifyRange } from 'postgres-range'
import { isArray } from 'radashi'
import { Interval } from './interval'

const noEscape = <T>(x: T) => x

const objectToString = Object.prototype.toString as (this: unknown) => string

const call = <This, Args extends any[], Return>(
  fn: (this: This, ...args: Args) => Return,
  ctx: This,
  ...args: Args
): Return => fn.call(ctx, ...args)

interface Tokenizer<Token> {
  val: (value: string) => Token
  raw: (value: string) => Token
}

type EscapedType = 'json' | 'range' | 'string'
type Escape = (value: string, type: EscapedType) => string

export function tokenizeValue<Token>(
  value: unknown,
  sql: Tokenizer<Token>,
  escape: Escape = noEscape,
): Token {
  if (value == null) {
    return sql.raw('null')
  }
  const type = typeof value
  switch (type) {
    case 'string':
      return sql.val(escape(value.toString(), type))
    case 'number':
    case 'boolean':
    case 'bigint':
      return sql.raw(value.toString())
    case 'object':
      return tokenizeObject(value, sql, escape)
  }
  throw new Error(`Unsupported type: ${type}`)
}

function tokenizeObject<Token>(
  obj: unknown,
  sql: Tokenizer<Token>,
  escape: Escape,
): Token {
  if (isArray(obj)) {
    return sql.val(tokenizeArray(obj))
  }
  switch (obj.constructor) {
    case Interval:
      return sql.val((obj as Interval).toISOString())
    case Range:
      return sql.val(escape(stringifyRange(obj as Range<any>), 'range'))
  }
  switch (call(objectToString, obj).slice(8, -1)) {
    case 'Date':
      return sql.val((obj as Date).toISOString())
    case 'RegExp':
      return sql.val((obj as RegExp).source)
  }
  if (isTypedArray(obj)) {
    obj = Buffer.from(obj)
  }
  if (Buffer.isBuffer(obj)) {
    return sql.val('\\x' + obj.toString('hex'))
  }
  return sql.val(escape(JSON.stringify(obj), 'json'))
}

const elementTokenizer = {
  const: noEscape<string>,
  raw: noEscape<string>,
}

function tokenizeArray(array: any[]) {
  let sql = '{'
  for (const value of array) {
    if (sql.length > 1) {
      sql += ','
    }
    sql += tokenizeValue(value, elementTokenizer, escapeArrayElement)
  }
  return sql + '}'
}

const BACKSLASH_RE = /\\/g
const DOUBLE_QUOTE_RE = /"/g
const SINGLE_QUOTE_RE = /'/g

function escapeArrayElement(str: string, type: EscapedType) {
  return type === 'json'
    ? "'" +
        str.replace(BACKSLASH_RE, '\\\\').replace(SINGLE_QUOTE_RE, "\\'") +
        "'"
    : '"' +
        str.replace(BACKSLASH_RE, '\\\\').replace(DOUBLE_QUOTE_RE, '\\"') +
        '"'
}
