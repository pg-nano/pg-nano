/**
 * Certain types have implicit coercion applied when passed to a Postgres
 * routine. This type widens type `T` recursively to allow coercible types.
 */
export type Input<T> = T extends (...args: any[]) => any
  ? T
  : T extends readonly (infer TElement)[]
    ? readonly Input<TElement>[]
    : T extends object
      ? { [K in keyof T]: Input<T[K]> }
      : T extends BigInt
        ? T | number
        : T extends undefined
          ? T | null
          : T
