import type { JSON } from './json'
import type { Timestamp } from './timestamp'

type IsTimestamp<T> = 'Timestamp' extends Extract<T, Timestamp>['__brand']
  ? true
  : false

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
        : T extends undefined
          ? T | null | undefined
          : T extends BigInt
            ? T | number
            : T extends object
              ? { [K in keyof T]: Input<T[K]> }
              : T
