import type Libpq from '@pg-nano/libpq'
import type EventEmitter from 'node:events'
import { debugQuery } from './debug.js'
import { PgNativeError } from './error.js'
import type { QueryDescriptor } from './query.js'
import { getResult } from './result.js'

/**
 * Call this before `pq.startRead()` to set up a result stream that will
 * automatically stop if the query is aborted.
 */
export async function* streamResults<TResult>(
  pq: Libpq,
  query: QueryDescriptor,
): AsyncGenerator<TResult, void, unknown> {
  pq.startRead()

  while (true) {
    await promisedEvent(pq, 'readable', query.ctrl.signal)
    query.ctrl.signal.throwIfAborted()

    // Attempt to buffer available data from the server.
    if (!pq.consumeInput()) {
      debugQuery(`query:${query.id} failed to consumeInput`)
      query.error = new PgNativeError(pq.getLastErrorMessage())
      return
    }

    // Process results unless the query is waiting for more data.
    while (!pq.isBusy()) {
      if (!pq.getResult()) {
        // Free the last result before ending the stream.
        return pq.clear()
      }

      // After an error, we flush results but don't yield them.
      if (!query.error) {
        const [error, result] = getResult(pq, query)

        if (error) {
          query.error = error
        } else if (result !== undefined) {
          yield result as TResult
        }
      }
    }

    // Free the last result before waiting for more data.
    pq.clear()
  }
}

function promisedEvent(
  emitter: EventEmitter,
  eventName: string,
  signal?: AbortSignal | null,
) {
  return new Promise<void>(resolve => {
    const onResolve = () => {
      emitter.removeListener(eventName, onResolve)
      signal?.removeEventListener('abort', onResolve)
      resolve()
    }
    emitter.addListener(eventName, onResolve)
    signal?.addEventListener('abort', onResolve)
  })
}
