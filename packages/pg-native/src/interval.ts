import PostgresInterval from 'postgres-interval'
import { isString } from 'radashi'

const parse = (PostgresInterval as any).parse as (
  input: string,
) => IntervalParts

const toISOString = PostgresInterval.prototype.toISOStringShort as (
  this: IntervalParts,
) => string

export interface IntervalParts {
  years?: number
  months?: number
  days?: number
  hours?: number
  minutes?: number
  seconds?: number
  milliseconds?: number
}

export class Interval {
  constructor(input: string | IntervalParts) {
    if (isString(input)) {
      Object.assign(this, parse(input))
    } else {
      Object.assign(this, parse(''), input)
    }
  }
}

Interval.prototype.toISOString = toISOString

export interface Interval extends Required<IntervalParts> {
  toISOString(): string
}
