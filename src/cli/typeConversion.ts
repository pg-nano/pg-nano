export type PgTypeMapping = {
  oid: number
  name: string
  jsType: string
  schema: string
}

const type = (oid: number, name: string, jsType: string): PgTypeMapping => ({
  oid,
  name,
  jsType,
  schema: 'pg_catalog',
})

/**
 * Type mappings from Postgres type OIDs to TypeScript types. This is intended
 * to contain every text parser supported by pg-types.
 *
 * @see https://github.com/pg-nano/pg-types/blob/master/lib/textParsers.js#L139
 */
export const typeMappings: PgTypeMapping[] = [
  type(16, 'bool', 'boolean'),
  type(17, 'bytea', 'Buffer'),
  type(20, 'int8', 'BigInt'),
  type(21, 'int2', 'number'),
  type(23, 'int4', 'number'),
  type(26, 'oid', 'number'),
  type(114, 'json', 'JSON'),
  type(600, 'point', 'Point'),
  type(700, 'float4', 'number'),
  type(701, 'float8', 'number'),
  type(718, 'circle', 'Circle'),
  type(1114, 'timestamp', 'Timestamp'),
  type(1184, 'timestamptz', 'Timestamp'),
  type(1186, 'interval', 'Interval'),
  type(2278, 'void', 'void'),
  type(3802, 'jsonb', 'JSON'),

  /* Range types */
  type(3904, 'int4range', 'Range<number>'),
  type(3906, 'numrange', 'Range<string>'),
  type(3908, 'tsrange', 'Range<Timestamp>'),
  type(3910, 'tstzrange', 'Range<Timestamp>'),
  type(3912, 'daterange', 'Range<string>'),
  type(3926, 'int8range', 'Range<BigInt>'),

  /* Array types */
  type(199, 'json[]', 'JSON[]'),
  type(651, 'cidr[]', 'string[]'),
  type(791, 'money[]', 'string[]'),
  type(1000, 'bool[]', 'boolean[]'),
  type(1001, 'bytea[]', 'Buffer[]'),
  type(1003, 'name[]', 'string[]'),
  type(1005, 'int2[]', 'number[]'),
  type(1007, 'int4[]', 'number[]'),
  type(1008, 'regproc[]', 'string[]'),
  type(1009, 'text[]', 'string[]'),
  type(1014, 'char[]', 'string[]'),
  type(1015, 'varchar[]', 'string[]'),
  type(1016, 'int8[]', 'BigInt[]'),
  type(1017, 'point[]', 'Point[]'),
  type(1021, 'float4[]', 'number[]'),
  type(1022, 'float8[]', 'number[]'),
  type(1028, 'oid[]', 'number[]'),
  type(1040, 'macaddr[]', 'string[]'),
  type(1041, 'inet[]', 'string[]'),
  type(1115, 'timestamp[]', 'Timestamp[]'),
  type(1182, 'date[]', 'string[]'),
  type(1183, 'time[]', 'string[]'),
  type(1185, 'timestamptz[]', 'Timestamp[]'),
  type(1187, 'interval[]', 'Interval[]'),
  type(1231, 'numeric[]', 'string[]'),
  type(1270, 'timetz[]', 'string[]'),
  type(2951, 'uuid[]', 'string[]'),
  type(3807, 'jsonb[]', 'JSON[]'),
  type(3907, 'numrange[]', 'Range<string>[]'),
  type(3909, 'tsrange[]', 'Range<Timestamp>[]'),
  type(3911, 'tstzrange[]', 'Range<Timestamp>[]'),
  type(3913, 'daterange[]', 'Range<string>[]'),
  type(3927, 'int8range[]', 'Range<BigInt>[]'),

  /* String types (not parsed by pg-types) */
  type(18, 'char', 'string'),
  type(19, 'name', 'string'),
  type(24, 'regproc', 'string'),
  type(25, 'text', 'string'),
  type(650, 'cidr', 'string'),
  type(790, 'money', 'string'),
  type(829, 'macaddr', 'string'),
  type(869, 'inet', 'string'),
  type(1042, 'bpchar', 'string'),
  type(1043, 'varchar', 'string'),
  type(1082, 'date', 'string'),
  type(1083, 'time', 'string'),
  type(1266, 'timetz', 'string'),
  type(1700, 'numeric', 'string'),
  type(2950, 'uuid', 'string'),
]

/**
 * Quick lookup for JS types by Postgres type OID.
 */
export const typeConversion: Record<number, string> = Object.fromEntries(
  typeMappings.map(t => [t.oid, t.jsType]),
)
