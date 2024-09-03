import type { EventEmitter } from 'node:events'
import { isPromise } from 'node:util/types'
import { isArray } from 'radashi'
import type { QueryFlag } from './flags'

export type UnwrapArray<T> = T extends any[] ? T[number] : T

/**
 * Converts an EventEmitter and event name pair into an async generator.
 */
export async function* generateEvents<T>(
  emitter: EventEmitter | Promise<EventEmitter>,
  eventName: string,
  transform?: (value: any) => T | T[],
): AsyncGenerator<T, never, unknown> {
  if (isPromise(emitter)) {
    emitter = await emitter
  }
  while (true) {
    const { promise, resolve } = Promise.withResolvers<T>()
    emitter.on(eventName, resolve)
    try {
      const value = await (transform ? transform(await promise) : promise)
      if (isArray(value)) {
        for (const item of value) {
          yield item
        }
      } else {
        yield value
      }
    } finally {
      emitter.off(eventName, resolve)
    }
  }
}

export function hasFlag(flags: QueryFlag | QueryFlag[], flag: QueryFlag) {
  return isArray(flags) ? flags.includes(flag) : flags === flag
}

export function arrifyParams(params: object, names: string[]) {
  const values: unknown[] = []
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(params, name)) {
      values.push(params[name as keyof object])
    } else {
      break
    }
  }
  return values
}
