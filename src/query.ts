import type { Client } from './mod'
import type { Result, SQLTemplate } from './pg-native'
import { generateEvents, type UnwrapArray } from './util.js'

export interface QueryOptions {
  /**
   * Cancel the query early when this signal is aborted.
   */
  signal?: AbortSignal
  /**
   * Transform the resolved value of the promise.
   * @internal
   */
  resolve?: (results: Result[]) => any
}

export class Query<
  TPromiseResult,
  TIteratorResult = UnwrapArray<TPromiseResult>,
> {
  protected options: QueryOptions | undefined

  constructor(
    protected client: Client,
    protected sql: SQLTemplate,
    protected transform?: (
      result: UnwrapArray<TPromiseResult>,
    ) => TIteratorResult | TIteratorResult[],
  ) {}

  /**
   * Set options for the query.
   */
  withOptions(options: QueryOptions | undefined) {
    if (options) {
      this.options = { ...this.options, ...options }
    }
    return this
  }

  // biome-ignore lint/suspicious/noThenProperty:
  then<TResult1 = TPromiseResult, TResult2 = never>(
    onfulfilled?:
      | ((value: TPromiseResult) => TResult1 | PromiseLike<TResult1>)
      | undefined
      | null,
    onrejected?:
      | ((reason: any) => TResult2 | PromiseLike<TResult2>)
      | undefined
      | null,
  ): PromiseLike<TResult1 | TResult2> {
    let promise = this.send()
    if (this.options?.resolve) {
      promise = promise.then(this.options.resolve)
    }
    return promise.then(onfulfilled, onrejected)
  }

  protected send(): Promise<any>
  protected send(iterableMode: true): AsyncIterable<TIteratorResult>
  protected send(
    iterableMode?: boolean,
  ): Promise<any> | AsyncIterable<TIteratorResult> {
    const client = this.client as unknown as {
      getConnection: Client['getConnection']
      dispatchQuery: Client['dispatchQuery']
    }
    const signal = this.options?.signal
    const connection = client.getConnection(signal)
    const promise = client.dispatchQuery(connection, this.sql, signal)
    return iterableMode
      ? generateEvents(connection, 'result', this.transform)
      : promise
  }

  [Symbol.asyncIterator]() {
    return this.send(true)[Symbol.asyncIterator]()
  }
}

export interface Query<
  TPromiseResult,
  TIteratorResult = UnwrapArray<TPromiseResult>,
> extends PromiseLike<TPromiseResult>,
    AsyncIterable<TIteratorResult> {}
