import { isTypedArray } from 'node:util/types'
import Interval from 'postgres-interval'
import { Range, serialize as stringifyRange } from 'postgres-range'
import { isFunction } from 'radashi'
import { Tuple } from './tuple.js'

// Tuple-marked objects exist to simplify pg-native tests. They are object
// literals that stringifyValue will render as a row literal (AKA a tuple).
export const tupleMarkedObjects = new WeakSet<object>()

// biome-ignore lint/suspicious/noConstEnum:
// biome-ignore lint/style/useEnumInitializers:
const enum DataType {
  Nullish,
  String,
  Number,
  Boolean,
  BigInt,
  Array,
  Tuple,
  TupleObject,
  Interval,
  Range,
  Date,
  TypedArray,
  Buffer,
  Json,
}

const nonEscapedTypes = new Set([
  DataType.Nullish,
  DataType.Number,
  DataType.Boolean,
  DataType.BigInt,
])

export type Escape = (str: string, type: DataType, quoteDepth: number) => string

export function stringifyValue(
  value: unknown,
  escape?: Escape | null,
  parentType?: DataType,
  quoteDepth = 0,
): string {
  const type = reflectType(value)
  const result = stringifyTypedValue(value, type, parentType, quoteDepth)
  if (escape && !nonEscapedTypes.has(type)) {
    return escape(result, type, quoteDepth)
  }
  return result
}

function stringifyArray(
  array: any[],
  parentType: DataType | undefined,
  quoteDepth: number,
) {
  // When an array literal is nested in another array literal, only the
  // outermost array literal should be wrapped in double quotes.
  const escapeRequired = parentType != null && parentType !== DataType.Array

  if (escapeRequired) {
    quoteDepth++
  }

  let str = '{'
  for (let i = 0; i < array.length; i++) {
    if (i > 0) {
      str += ','
    }
    str += stringifyValue(array[i], escapeElement, DataType.Array, quoteDepth)
  }
  str += '}'

  if (escapeRequired) {
    return quoteWrap(str, quoteDepth - 1)
  }
  return str
}

function stringifyTuple(
  tuple: Tuple,
  parentType: DataType | undefined,
  quoteDepth: number,
) {
  const escapeRequired = parentType != null
  
  if (escapeRequired) {
    quoteDepth++
  }

  let str = '('
  for (let i = 0; i < tuple.length; i++) {
    if (i > 0) {
      str += ','
    }
    // NULL values can be omitted from the tuple literal.
    if (tuple[i] !== null) {
      str += stringifyValue(tuple[i], escapeElement, DataType.Tuple, quoteDepth)
    }
  }
  str += ')'

  if (escapeRequired) {
    return quoteWrap(str, quoteDepth - 1)
  }
  return str
}

const BACKSLASH_RE = /\\/g
const DOUBLE_QUOTE_RE = /"/g

// Used by array literals and tuple literals.
function escapeElement(str: string, type: DataType, quoteDepth: number) {
  switch (type) {
    case DataType.String:
    case DataType.Json: {
      const escape = '\\'.repeat(2 ** (quoteDepth + 1) - 1)
      return quoteWrap(
        str
          .replace(BACKSLASH_RE, escape + '\\')
          .replace(DOUBLE_QUOTE_RE, escape + '"'),
        quoteDepth,
      )
    }
  }
  return str
}

function stringifyTypedValue(
  value: unknown,
  type: DataType,
  parentType: DataType | undefined,
  quoteDepth: number,
) {
  switch (type) {
    case DataType.Nullish:
      return 'null'
    case DataType.String:
      return value as string
    case DataType.Number:
    case DataType.Boolean:
    case DataType.BigInt:
      return (value as number | boolean | bigint).toString()
    case DataType.Array:
      return stringifyArray(value as any[], parentType, quoteDepth)
    case DataType.Tuple:
      return stringifyTuple(value as Tuple, parentType, quoteDepth)
    case DataType.Json:
      return JSON.stringify(value)
    case DataType.Date:
      return (value as Date).toISOString()
    case DataType.Interval:
      return (value as Interval).toISOStringShort()
    case DataType.Range:
      return stringifyRange(value as Range<any>)
    case DataType.TypedArray:
      value = Buffer.from(value as Uint8Array)
    /* fallthrough */
    case DataType.Buffer:
      return '\\x' + (value as Buffer).toString('hex')
    case DataType.TupleObject:
      return stringifyTuple(
        Object.values(value as object) as Tuple,
        parentType,
        quoteDepth,
      )
  }
}

const typeofMap: Record<string, DataType> = {
  string: DataType.String,
  number: DataType.Number,
  boolean: DataType.Boolean,
  bigint: DataType.BigInt,
}

function reflectType(value: unknown) {
  if (value == null) {
    return DataType.Nullish
  }
  const type = typeof value
  if (type === 'object') {
    switch (value.constructor) {
      case Array:
        return DataType.Array
      case Tuple:
        return DataType.Tuple
      case Date:
        return DataType.Date
      case Interval:
        return DataType.Interval
      case Range:
        return DataType.Range
    }
    if (Buffer.isBuffer(value)) {
      return DataType.Buffer
    }
    if (isTypedArray(value)) {
      return DataType.TypedArray
    }
    if (
      process.env.NODE_ENV !== 'production' &&
      tupleMarkedObjects.has(value)
    ) {
      return DataType.TupleObject
    }
    if (
      value.constructor === undefined ||
      value.constructor === Object ||
      isFunction((value as any).toJSON)
    ) {
      return DataType.Json
    }
  } else {
    const typeId = typeofMap[type]
    if (typeId != null) {
      return typeId
    }
  }
  throw new Error(`Unsupported type: ${type}`)
}

function quoteWrap(str: string, quoteDepth: number) {
  // The quote may need to be escaped if it's nested in another quote-wrapped
  // literal like an array or tuple.
  const quote = '\\'.repeat(2 ** quoteDepth - 1) + '"'
  return quote + str + quote
}
