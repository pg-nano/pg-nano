import * as array from 'postgres-array'
import parseByteA from 'postgres-bytea'
import parseTimestampTz from 'postgres-date'
import parseInterval from 'postgres-interval'
import * as range from 'postgres-range'

function parseArray(transform: (value: string) => any) {
  return (value: string) => array.parse(value, transform)
}

function parseBool(value: string) {
  return value === 't'
}

function parseCircle(value: string) {
  if (value[0] !== '<' && value[1] !== '(') {
    return null
  }
  let point = '('
  let radius = ''
  let pointParsed = false
  for (let i = 2; i < value.length - 1; i++) {
    if (!pointParsed) {
      point += value[i]
    }
    if (value[i] === ')') {
      pointParsed = true
      continue
    }
    if (pointParsed && value[i] !== ',') {
      radius += value[i]
    }
  }
  const result = parsePoint(point)
  if (result === null) {
    return null
  }
  return {
    ...result,
    radius: Number.parseFloat(radius),
  }
}

function parsePoint(value: string) {
  if (value[0] !== '(') {
    return null
  }
  const [x, y] = value.substring(1, value.length - 1).split(',')
  return {
    x: Number.parseFloat(x),
    y: Number.parseFloat(y),
  }
}

function parseRange(transform: (value: string) => any) {
  return (value: string) => range.parse(value, transform)
}

function parseString(value: string) {
  return value
}

function parseTimestamp(value: string) {
  const utc = value.endsWith(' BC') ? value.slice(0, -3) + 'Z BC' : value + 'Z'
  return parseTimestampTz(utc)
}

const parseBigInt = BigInt
const parseFloat = Number.parseFloat
const parseInt = Number

const parseIntArray = parseArray(parseInt)
const parseFloatArray = parseArray(parseFloat)
const parseStringArray = parseArray(parseString)
const parseBigIntArray = parseArray(parseBigInt)
const parseJsonArray = parseArray(JSON.parse)

const parseIntRange = parseRange(parseInt)
const parseBigIntRange = parseRange(parseBigInt)
const parseTimestampRange = parseRange(parseTimestamp)
const parseTimestampTzRange = parseRange(parseTimestampTz)
const parseDateRange = parseRange(parseString)

const textParsers: Record<number, (value: string) => any> = {
  16: parseBool, // bool
  17: parseByteA, // bytea
  20: parseBigInt, // int8
  21: parseInt, // int2
  23: parseInt, // int4
  26: parseInt, // oid
  114: JSON.parse, // json
  600: parsePoint, // point
  700: parseFloat, // float4
  701: parseFloat, // float8
  718: parseCircle, // circle
  1114: parseTimestamp, // timestamp without time zone
  1184: parseTimestampTz, // timestamp with time zone
  1186: parseInterval, // interval
  1700: parseBigInt, // numeric
  3802: JSON.parse, // jsonb

  // Range types
  3904: parseIntRange, // int4range
  3906: parseBigIntRange, // numrange
  3908: parseTimestampRange, // tsrange
  3910: parseTimestampTzRange, // tstzrange
  3912: parseDateRange, // daterange
  3926: parseBigIntRange, // int8range

  // Array types
  199: parseJsonArray, // json[]
  651: parseStringArray, // cidr[]
  791: parseStringArray, // money[]
  1000: parseArray(parseBool), // bool[]
  1001: parseArray(parseByteA), // bytea[]
  1003: parseStringArray, // name[]
  1005: parseIntArray, // int2[]
  1007: parseIntArray, // int4[]
  1008: parseStringArray, // regproc[]
  1009: parseStringArray, // text[]
  1014: parseStringArray, // bpchar[]
  1015: parseStringArray, // varchar[]
  1016: parseBigIntArray, // int8[]
  1017: parseArray(parsePoint), // point[]
  1021: parseFloatArray, // float4[]
  1022: parseFloatArray, // float8[]
  1028: parseIntArray, // oid[]
  1040: parseStringArray, // macaddr[]
  1041: parseStringArray, // inet[]
  1115: parseArray(parseTimestamp), // timestamp without time zone[]
  1183: parseStringArray, // time[]
  1182: parseStringArray, // date[]
  1185: parseArray(parseTimestampTz), // timestamp with time zone[]
  1187: parseArray(parseInterval), // interval[]
  1231: parseBigIntArray, // numeric[]
  1270: parseStringArray, // timetz[]
  2951: parseStringArray, // uuid[]
  3807: parseJsonArray, // jsonb[]
  3905: parseArray(parseIntRange), // int4range[]
  3907: parseArray(parseBigIntRange), // numrange[]
  3909: parseArray(parseTimestampRange), // tsrange[]
  3911: parseArray(parseTimestampTzRange), // tstzrange[]
  3913: parseArray(parseDateRange), // daterange[]
  3927: parseArray(parseBigIntRange), // int8range[]
}

export function getTypeParser(oid: number) {
  return textParsers[oid] || parseString
}

export function setTypeParser(oid: number, parser: (value: string) => any) {
  textParsers[oid] = parser
}
