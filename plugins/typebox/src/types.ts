import { type Static, type TSchema, Type } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { parseRange, Interval as PgInterval, stringifyRange } from 'pg-nano'

export type Circle = Static<typeof Circle>
export const Circle = Type.Object({
  x: Type.Number(),
  y: Type.Number(),
  radius: Type.Number(),
})

export type JSON = import('pg-nano').JSON
export const JSON = Type.Recursive(This =>
  Type.Union([
    Type.String(),
    Type.Number(),
    Type.Boolean(),
    Type.Object({}, { additionalProperties: This }),
    Type.Array(This),
    Type.Null(),
  ]),
)

export type Point = Static<typeof Point>
export const Point = Type.Object({
  x: Type.Number(),
  y: Type.Number(),
})

/**
 * When a timestamp is not a Date instance, it's either Infinity or -Infinity.
 * @see https://www.postgresql.org/docs/current/datatype-datetime.html#DATATYPE-DATETIME-SPECIAL-VALUES
 */
export type Timestamp = Static<typeof Timestamp>
export const Timestamp = Type.Union([Type.Date(), Type.Number()], {
  description:
    "When a timestamp is not a Date instance, it's either Infinity or -Infinity.",
  see: 'https://www.postgresql.org/docs/current/datatype-datetime.html#DATATYPE-DATETIME-SPECIAL-VALUES',
})

export type Interval = typeof import('pg-nano').Interval
export const Interval = Type.Transform(
  Type.Union([
    Type.String(),
    Type.Partial(
      Type.Object({
        days: Type.Number(),
        hours: Type.Number(),
        minutes: Type.Number(),
        seconds: Type.Number(),
        milliseconds: Type.Number(),
      }),
    ),
  ]),
)
  .Decode(input => new PgInterval(input))
  .Encode(input => input.toISOString())

export type Range = typeof import('pg-nano').Range
export const Range = <TBound extends TSchema>(Bound: TBound) => {
  const decodeBound = (bound: string) =>
    Value.Decode(Bound, bound) as Extract<Static<TBound>, {}>

  return Type.Transform(
    Type.String({
      pattern: '^empty$|^\\[.*?\\)$|^\\[.*?\\]$|^\\[.*?\\)$|^\\[.*?\\)$',
    }),
  )
    .Decode(input =>
      parseRange<Extract<Static<TBound>, {}>>(input, decodeBound),
    )
    .Encode(input => stringifyRange(input))
}
