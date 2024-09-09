import { isPromise } from 'node:util/types'
import type { Connection, Result } from 'pg-native'
import { isArray } from 'radashi'

/**
 * Converts an EventEmitter and event name pair into an async generator.
 */
export async function* streamResults<T>(
  conn: Connection | Promise<Connection>,
  transform?: (value: any) => T | T[],
): AsyncGenerator<any, void, unknown> {
  if (isPromise(conn)) {
    conn = await conn
  }
  const endSymbol: any = Symbol('end')
  while (true) {
    const { promise, resolve, reject } = Promise.withResolvers<Result>()
    const end = () => resolve(endSymbol)
    conn.on('result', resolve)
    conn.on('error', reject)
    conn.on('end', end)
    try {
      const result = await promise
      if (result === endSymbol) {
        return
      }
      const value: any = await (transform ? transform(result) : result)
      if (isArray(value)) {
        yield* value as any
      } else {
        yield value
      }
    } finally {
      conn.off('result', resolve)
      conn.off('error', reject)
      conn.off('end', end)
    }
  }
}
