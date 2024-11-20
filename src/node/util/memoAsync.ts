export function memoAsync<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  options: {
    /**
     * The time-to-live (TTL) for the cache in milliseconds.
     * If not provided, the cache will never expire.
     */
    ttl?: number
    /**
     * A function that returns a unique key for the given arguments.
     * If not provided, the first argument is used as the key.
     */
    toKey?: (...args: Parameters<T>) => unknown
  } = {},
): T {
  const cache = new Map<unknown, { promise: Promise<any>; timestamp: number }>()
  const { ttl = 0, toKey } = options
  let timeoutId: unknown

  function vacateExpired() {
    const now = Date.now()
    for (const [key, entry] of cache) {
      if (now - entry.timestamp > ttl) {
        cache.delete(key)
      }
    }
    timeoutId = null
  }

  function scheduleVacate() {
    if (ttl > 0 && !timeoutId) {
      timeoutId = setTimeout(vacateExpired, ttl)
    }
  }

  return ((...args: Parameters<T>) => {
    const key = toKey ? toKey(...args) : args[0]
    const cached = cache.get(key)

    if (cached) {
      return cached.promise
    }

    const promise = fn(...args)
    cache.set(key, { promise, timestamp: Date.now() })
    scheduleVacate()

    promise.catch(() => {
      cache.delete(key)
    })

    return promise
  }) as T
}
