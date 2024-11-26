export interface MemoOptions<Fn extends (...args: any[]) => any> {
  cache?: Record<string, ReturnType<Fn>>
  key?: (...args: Parameters<Fn>) => string
}

/**
 * Creates a memoized function. The returned function will only
 * execute the source function when no value has previously been
 * computed.
 *
 * @see https://radashi-org.github.io/reference/curry/memo
 * @example
 * ```ts
 * const calls: number[] = []
 * const fib = memo((x: number) => {
 *   calls.push(x)
 *   return x < 2 ? x : fib(x - 1) + fib(x - 2)
 * })
 *
 * fib(10) // 55
 * fib(10) // 55
 * // calls === [10]
 *
 * fib(11) // 89
 * // calls === [10, 11]
 * ```
 */
export function memo<Fn extends (...args: any[]) => any>(
  func: Fn,
  options: MemoOptions<Fn> = {},
): Memoized<Fn> {
  const { key: keyFunc, cache = {} } = options

  return function callWithMemo(...args) {
    const key = keyFunc ? keyFunc(...args) : JSON.stringify({ args })
    if (key in cache) {
      return cache[key]
    }
    const result = func(...args)
    cache[key] = result
    return result
  } as Memoized<Fn>
}

export type Memoized<Fn extends (...args: any[]) => any> =
  ReturnType<Fn> extends infer Result
    ? (...args: Parameters<Fn>) => Result
    : never
