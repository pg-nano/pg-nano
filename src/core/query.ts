import {
  type Connection,
  type PgNativeError,
  type PgResultError,
  type QueryHook,
  type QueryOptions,
  type QueryType,
  SQLTemplate,
} from 'pg-native'
import { isArray, noop } from 'radashi'
import { FieldCase, snakeToCamel } from './casing.js'
import type { Client } from './client.js'
import { QueryError } from './error.js'

type UnwrapArray<T> = T extends readonly (infer U)[] ? U : T

// The Query class relies on protected members of the Client class, so this type
// is used to allow it protected access.
interface QueryClient {
  config: Client['config']
  getConnection: Client['getConnection']
  onIdleConnection: Client['onIdleConnection']
  parseText: Client['parseText']
}

// biome-ignore lint/suspicious/noConstEnum:
export const enum QueryResultCount {
  any = 0,
  zeroOrOne = 1,
  exactlyOne = 2,
}

export declare namespace Query {
  type Options = Omit<QueryOptions, 'singleRowMode'>
}

export class Query<
  TPromiseResult,
  TIteratorResult = UnwrapArray<TPromiseResult>,
> {
  protected client: QueryClient
  protected trace?: Error = undefined
  constructor(
    client: Client,
    protected type: QueryType,
    protected input: SQLTemplate | QueryHook<any>,
    protected options?: Query.Options | null,
    protected expectedCount?: QueryResultCount,
  ) {
    this.client = client as unknown as QueryClient
    if (client.config.debug) {
      this.trace = new Error()
      Error.captureStackTrace(this.trace, Query)
    }
  }

  /**
   * Request that the query be cancelled and stop all processing. Does nothing
   * if the query hasn't been awaited yet.
   */
  public cancel: () => void = noop

  protected signal?: AbortSignal

  /**
   * Request that the query be cancelled when the given signal is aborted.
   *
   * Note: This must be called before the query is awaited.
   */
  cancelWithSignal(signal: AbortSignal | null | undefined) {
    if (signal) {
      this.signal = signal
    }
    return this
  }

  /**
   * Transform a query with an expectation of "zero or one" results into a query
   * with an expectation of "exactly one" result.
   */
  notNull(): TPromiseResult | null extends TPromiseResult
    ? Query<Exclude<TPromiseResult, null>>
    : this {
    if (this.expectedCount === QueryResultCount.zeroOrOne) {
      this.expectedCount = QueryResultCount.exactlyOne
    }
    return this as any
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
    return this.send().then(onfulfilled, onrejected)
  }

  catch<TCatchResult = TPromiseResult>(
    onrejected?:
      | ((
          reason: (Error | PgNativeError | PgResultError) & { command: string },
        ) => TCatchResult | PromiseLike<TCatchResult>)
      | undefined
      | null,
  ): Promise<TPromiseResult | TCatchResult> {
    return this.send().catch(onrejected)
  }

  finally(
    onfinally?: (() => void) | undefined | null,
  ): Promise<TPromiseResult> {
    return this.send().finally(onfinally)
  }

  [Symbol.asyncIterator]() {
    return this.send(true)[Symbol.asyncIterator]()
  }

  protected send(): Promise<TPromiseResult>
  protected send(singleRowMode: true): AsyncIterable<TIteratorResult>
  protected send(singleRowMode?: boolean): Promise<any> | AsyncIterable<any> {
    const connecting = this.client.getConnection(this.signal)
    const queryPromise = this.promise(connecting, this.input, {
      ...this.options,
      singleRowMode,
      mapFieldName:
        this.options?.mapFieldName ??
        (this.client.config.fieldCase === FieldCase.camel
          ? snakeToCamel
          : undefined),
    })
      .catch(error => {
        if (this.trace) {
          this.trace.stack =
            error.stack +
            '\n    ――― Query constructor trace ―――\n' +
            this.trace.stack!.replace(/^.*?\n/, '')

          Object.assign(this.trace, error)
          this.trace.message = error.message
          error = this.trace
        }
        if (SQLTemplate.isTemplate(this.input)) {
          error.command = this.input.command
        }
        throw error
      })
      .finally(async () => {
        try {
          this.client.onIdleConnection(await connecting)
        } catch (error) {
          console.error(error)
        }
      })

    if (singleRowMode) {
      return this.stream(connecting, queryPromise)
    }
    return queryPromise
  }

  protected async promise(
    connecting: Promise<Connection>,
    input: SQLTemplate | QueryHook<any>,
    options?: QueryOptions | null,
  ): Promise<any> {
    const connection = await connecting
    this.signal?.throwIfAborted()

    const promise = connection.query(
      this.type,
      input,
      this.client.parseText,
      options,
    )

    this.cancel = promise.cancel
    this.signal?.addEventListener('abort', this.cancel)

    if (this.expectedCount) {
      const rows: any[] = await promise
      if (!isArray(rows)) {
        throw new QueryError(`Expected array, got ${typeof rows}`)
      }
      if (rows.length > 1) {
        throw new QueryError(`Expected at most 1 row, got ${rows.length}`)
      }
      if (rows.length === 0) {
        if (this.expectedCount === QueryResultCount.exactlyOne) {
          throw new QueryError('Expected row, got undefined')
        }
        return null
      }
      return rows[0]
    }
    return promise
  }

  protected async *stream(
    connecting: Promise<Connection>,
    queryPromise: Promise<any>,
  ) {
    yield* (await connecting).stream()

    // Propagate any errors from the query.
    await queryPromise
  }
}

export interface Query<
  TPromiseResult,
  TIteratorResult = UnwrapArray<TPromiseResult>,
> extends PromiseLike<TPromiseResult>,
    AsyncIterable<TIteratorResult> {}
