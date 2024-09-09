import type { Result, SQLTemplate } from 'pg-native'
import type { Client } from './mod'
import { streamResults } from './stream.js'
import type { UnwrapArray } from './util.js'

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
  then<TResult = TPromiseResult, TCatchResult = never>(
    onfulfilled?:
      | ((value: TPromiseResult) => TResult | PromiseLike<TResult>)
      | undefined
      | null,
    onrejected?:
      | ((reason: any) => TCatchResult | PromiseLike<TCatchResult>)
      | undefined
      | null,
  ): Promise<TResult | TCatchResult> {
    let promise = this.send()
    if (this.options?.resolve) {
      promise = promise.then(this.options.resolve)
    }
    return promise.then(onfulfilled, onrejected)
  }

  catch<TCatchResult = TPromiseResult>(
    onrejected?:
      | ((reason: any) => TCatchResult | PromiseLike<TCatchResult>)
      | undefined
      | null,
  ): Promise<TPromiseResult | TCatchResult> {
    return this.then(undefined, onrejected)
  }

  finally(
    onfinally?: (() => void) | undefined | null,
  ): Promise<TPromiseResult> {
    return Promise.resolve(this).finally(onfinally)
  }

  protected send(): Promise<any>
  protected send(singleRowMode: true): AsyncIterable<TIteratorResult>
  protected send(
    singleRowMode?: boolean,
  ): Promise<any> | AsyncIterable<TIteratorResult> {
    const client = this.client as unknown as {
      getConnection: Client['getConnection']
      dispatchQuery: Client['dispatchQuery']
    }
    const signal = this.options?.signal
    const connection = client.getConnection(signal)
    const promise = client.dispatchQuery(
      connection,
      this.sql,
      signal,
      singleRowMode,
    )
    if (singleRowMode) {
      return streamResults(connection, this.transform)
    }
    return promise
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
