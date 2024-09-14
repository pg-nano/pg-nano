/**
 * Type mappings from Postgres type OIDs to TypeScript types. This is intended
 * to contain every text parser supported by pg-types.
 *
 * @see https://github.com/pg-nano/pg-types/blob/master/lib/textParsers.js#L139
 */
export const jsTypesByOid: Record<number, string> = {
  16: 'boolean',
  17: 'Buffer',
  20: 'BigInt',
  21: 'number',
  23: 'number',
  26: 'number',
  114: 'JSON',
  600: 'Point',
  700: 'number',
  701: 'number',
  718: 'Circle',
  1114: 'Timestamp',
  1184: 'Timestamp',
  1186: 'Interval',
  2278: 'void',
  3802: 'JSON',

  /* Range types */
  3904: 'Range<number>',
  3906: 'Range<string>',
  3908: 'Range<Timestamp>',
  3910: 'Range<Timestamp>',
  3912: 'Range<string>',
  3926: 'Range<BigInt>',
}
