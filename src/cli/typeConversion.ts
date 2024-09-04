/**
 * Type conversion from Postgres type OIDs to TypeScript types. This is
 * hard-coded because runtime type parsing is hard-coded.
 *
 * Adapted from
 * https://github.com/pg-nano/pg-types/blob/master/lib/textParsers.js#L139
 */
export const typeConversion: Record<number, string> = {
  16: 'boolean', // bool
  17: 'Buffer', // bytea
  20: 'string', // int8
  21: 'number', // int2
  23: 'number', // int4
  26: 'number', // oid
  114: 'unknown', // json
  199: 'unknown[]', // json[]
  600: 'Point', // point
  651: 'string[]', // cidr[]
  700: 'number', // float4/real
  701: 'number', // float8/double
  718: 'Circle', // circle
  791: 'string[]', // money[]
  1000: 'boolean[]',
  1001: 'Buffer[]', // bytea[]
  1005: 'number[]', // int2[]
  1007: 'number[]', // int4[]
  1008: 'string[]', // regproc[]
  1009: 'string[]', // text[]
  1014: 'string[]', // char[]
  1015: 'string[]', // varchar[]
  1016: 'number[]', // int8[]
  1017: 'Point[]', // point[]
  1021: 'number[]', // float4[]
  1022: 'number[]', // float8[]
  1028: 'number[]', // oid[]
  1040: 'string[]', // macaddr[]
  1041: 'string[]', // inet[]
  1114: 'Date', // timestamp without time zone
  1115: 'Date[]', // timestamp without time zone[]
  1182: 'string[]', // date[]
  1183: 'string[]', // time[]
  1184: 'Date', // timestamp with time zone
  1185: 'Date[]', // timestamp with time zone[]
  1186: 'Interval', // interval
  1187: 'Interval[]', // interval[]
  1231: 'string[]', // numeric[]
  1270: 'string[]', // timetz[]
  2951: 'string[]', // uuid[]
  3802: 'unknown', // jsonb
  3807: 'unknown[]', // jsonb[]
  3904: 'Range<number>', // int4range
  3906: 'Range<number>', // numrange
  3907: 'string[]', // numrange[]
  3908: 'Range<Date>', // tsrange
  3910: 'Range<Date>', // tstzrange
  3912: 'Range<string>', // daterange
  3926: 'Range<string>', // int8range

  /* String types (not parsed by pg-types) */
  18: 'string', // char
  19: 'string', // name
  24: 'string', // regproc
  25: 'string', // text
  650: 'string', // cidr
  790: 'string', // money
  829: 'string', // macaddr
  869: 'string', // inet
  1042: 'string', // bpchar
  1043: 'string', // varchar
  1082: 'string', // date
  1083: 'string', // time
  1266: 'string', // timetz
  1700: 'string', // numeric
  2950: 'string', // uuid
}
