import type { Range } from 'postgres-range'
import type { Intersect, Simplify } from 'radashi'
import type { JSON } from './json'
import type { Timestamp } from './timestamp'

type IsExact<T, U> = [T] extends [U] ? ([U] extends [T] ? true : false) : false

type IsTimestamp<T> = IsExact<
  Extract<T, Timestamp>['__brand'],
  'Timestamp' | undefined
>

/**
 * Certain types have implicit coercion applied when passed to a Postgres
 * routine. This type widens type `T` recursively to allow coercible types.
 */
export type Input<T> = JSON extends T
  ? JSON
  : T extends (...args: any[]) => any
    ? T
    : T extends readonly (infer TElement)[]
      ? TElement[] extends T
        ? readonly Input<TElement>[]
        : // Avoid widening tuples to arrays.
          { [Index in keyof T]: Input<T[Index]> }
      : IsTimestamp<T> extends true
        ? Date | number
        : T extends BigInt
          ? T | number
          : T extends Range<infer TSubtype>
            ? Range<Input<TSubtype>>
            : T extends object
              ? Optionize<{ [K in keyof T]: Input<T[K]> }>
              : T

// Allow nullable fields to be omitted. This type is implemented with Intersect
// to preserve the order of the keys, and with Simplify to reduce the type into
// a more readable type literal.
type Optionize<T extends object> = Simplify<
  Intersect<
    keyof T extends infer TKey
      ? TKey extends keyof T
        ? null extends T[TKey]
          ? Partial<Pick<T, TKey>>
          : Pick<T, TKey>
        : never
      : never
  >
>
