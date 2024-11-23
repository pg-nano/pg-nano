/**
 * Note: Not all Postgres types are included here. If not found here, the type
 * is either unsupported or it maps to a JavaScript string type.
 */
export const jsTypeByPgName: Record<string, string> = {
  bool: 'boolean',
  bytea: 'Buffer',
  circle: 'Circle',
  daterange: 'Range<Timestamp>',
  float4: 'number',
  float8: 'number',
  int2: 'number',
  int4: 'number',
  int4range: 'Range<number>',
  int8: 'BigInt',
  int8range: 'Range<BigInt>',
  interval: 'Interval',
  json: 'JSON',
  jsonb: 'JSON',
  numrange: 'Range<string>',
  oid: 'number',
  point: 'Point',
  timestamp: 'Timestamp',
  timestamptz: 'Timestamp',
  tsrange: 'Range<Timestamp>',
  tstzrange: 'Range<Timestamp>',
  void: 'void',
}

/**
 * Postgres "range" types mapped to their subtypes (i.e. the type of the range's
 * bounds).
 */
export const subtypeByPgName: Record<string, string> = {
  daterange: 'date',
  int4range: 'int4',
  int8range: 'int8',
  numrange: 'numeric',
  tsrange: 'timestamp',
  tstzrange: 'timestamptz',
}
