import { isPromise } from 'node:util/types'
import {
  type Connection,
  FieldCase,
  type PgNativeError,
  type PgResultError,
  type QueryHook,
  type QueryOptions,
  type QueryType,
  SQLTemplate,
} from 'pg-native'
import { isArray, noop } from 'radashi'
import { snakeToCamel } from './casing.js'
import type { Client } from './client.js'
import { QueryError } from './error.js'

type UnwrapArray<T> = T extends readonly (infer U)[] ? U : T

export declare namespace Query {
  type Options = Omit<QueryOptions, 'singleRowMode'>
}

export class Query<
  TPromiseResult,
  TIteratorResult = UnwrapArray<TPromiseResult>,
> {
  constructor(
    protected client: Client,
    protected type: QueryType,
    protected input: SQLTemplate | QueryHook<any>,
    protected options?: Query.Options | null,
    protected expectedCount?: '[0,1]' | '[1,1]' | null,
  ) {}

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
  cancelWithSignal(signal: AbortSignal) {
    this.signal = signal
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
    return this.send().then(onfulfilled, onrejected)
  }

  catch<TCatchResult = TPromiseResult>(
    onrejected?:
      | ((
          reason: (Error | PgNativeError | PgResultError) & { ddl: string },
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
    const client = this.client as unknown as {
      config: Client['config']
      getConnection: Client['getConnection']
      onQueryFinished: Client['onQueryFinished']
    }
    const connection = client.getConnection(this.signal)
    const promise = this.promise(connection, this.input, {
      ...this.options,
      singleRowMode,
      mapFieldName:
        this.options?.mapFieldName ??
        (client.config.fieldCase === FieldCase.camel
          ? snakeToCamel
          : undefined),
    })
      .catch(error => {
        if (this.input instanceof SQLTemplate) {
          error.ddl = this.input.ddl
        }
        Error.captureStackTrace(error, this.send)
        throw error
      })
      .finally(() => {
        try {
          client.onQueryFinished()
        } catch (error) {
          console.error(error)
        }
      })

    if (singleRowMode) {
      return this.stream(connection, promise)
    }
    return promise
  }

  protected async promise(
    connection: Connection | Promise<Connection>,
    input: SQLTemplate | QueryHook<any>,
    options?: QueryOptions | null,
  ): Promise<any> {
    if (isPromise(connection)) {
      // Only await the connection if necessary, so the connection status can
      // change to QUERY_WRITING as soon as possible.
      connection = await connection
      this.signal?.throwIfAborted()
    }

    const client = this.client as unknown as {
      parseText: Client['parseText']
    }

    const promise = connection.query(
      this.type,
      input,
      client.parseText,
      options,
    )

    this.cancel = promise.cancel
    this.signal?.addEventListener('abort', this.cancel)

    if (this.expectedCount) {
      const rows: any[] = await promise
      if (rows.length > 1) {
        throw new QueryError(`Expected at most 1 row, got ${rows.length}`)
      }
      if (rows.length === 0) {
        if (this.expectedCount === '[1,1]') {
          throw new QueryError('Expected row, got undefined')
        }
        return null
      }
      return rows[0]
    }
    return promise
  }

  protected async *stream(
    conn: Connection | Promise<Connection>,
    queryPromise: Promise<any>,
  ) {
    if (isPromise(conn)) {
      conn = await conn
    }

    yield* conn.stream()

    // Propagate any errors from the query.
    await queryPromise
  }
}

export interface Query<
  TPromiseResult,
  TIteratorResult = UnwrapArray<TPromiseResult>,
> extends PromiseLike<TPromiseResult>,
    AsyncIterable<TIteratorResult> {}
