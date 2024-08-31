import createDebug from 'debug'
import type { EventEmitter } from 'node:events'
import { isPromise } from 'node:util/types'
import { isArray, sleep } from 'radashi'
import { ClientStatus, Client as Connection } from './pg-native/index.js'
import type { Field, Result, Row } from './pg-native/result.js'

const debug = /** @__PURE__ */ createDebug('pg-nano')

export type { Field, Result, Row }

export interface PostgresConfig {
  /**
   * The minimum number of connections to maintain in the pool.
   * @default 1
   */
  minConnections: number

  /**
   * The maximum number of connections allowed in the pool.
   * @default 100
   */
  maxConnections: number

  /**
   * The initial delay (in milliseconds) before retrying a failed connection.
   * @default 250
   */
  initialRetryDelay: number

  /**
   * The maximum delay (in milliseconds) between connection retry attempts.
   * @default 10000
   */
  maxRetryDelay: number

  /**
   * The maximum number of times to retry connecting before giving up.
   * @default Number.POSITIVE_INFINITY
   */
  maxRetries: number

  /**
   * The time (in milliseconds) after which an idle connection is closed.
   * @default 30000
   */
  idleTimeout: number
}

/**
 * A minimal connection pool for Postgres.
 *
 * Note that `maxConnections` defaults to 100, which assumes you only have one
 * application server. If you have multiple application servers, you probably
 * want to lower this value by dividing it by the number of application servers.
 */
export class Postgres {
  protected pool: (Connection | Promise<Connection>)[] = []
  protected backlog: ((err?: Error) => void)[] = []

  readonly dsn: string | null = null
  readonly config: Readonly<PostgresConfig>

  constructor({
    minConnections = 1,
    maxConnections = 100,
    initialRetryDelay = 250,
    maxRetryDelay = 10e3,
    maxRetries = Number.POSITIVE_INFINITY,
    idleTimeout = 30e3,
  }: Partial<PostgresConfig> = {}) {
    this.config = {
      minConnections,
      maxConnections,
      initialRetryDelay,
      maxRetryDelay,
      maxRetries,
      idleTimeout,
    }
  }

  protected async connectWithRetry(
    connection: Connection,
    signal?: AbortSignal,
    retries = Math.max(this.config.maxRetries, 0),
    delay = Math.max(this.config.initialRetryDelay, 0),
  ): Promise<void> {
    if (!this.dsn) {
      throw new Error('Postgres is not connected')
    }
    signal?.throwIfAborted()
    try {
      await connection.connect(this.dsn)
    } catch (error) {
      if (retries > 0) {
        signal?.throwIfAborted()

        if (delay > 0) {
          await sleep(delay)
        }
        return this.connectWithRetry(
          connection,
          signal,
          retries - 1,
          Math.min(delay * 2, this.config.maxRetryDelay),
        )
      }
      throw error
    }
  }

  protected addConnection(
    signal?: AbortSignal,
    idleTimeout = this.config.idleTimeout,
  ): Promise<Connection> {
    const connection = new Connection(idleTimeout)

    const connecting = this.connectWithRetry(connection, signal).then(
      () => {
        const index = this.pool.indexOf(connecting)
        this.pool[index] = connection

        connection.on('close', () => {
          this.removeConnection(connection)
        })

        return connection
      },
      error => {
        this.removeConnection(connecting)
        throw error
      },
    )

    this.pool.push(connecting)

    if (debug.enabled) {
      const index = this.pool.indexOf(connecting)
      connecting.then(() => {
        if (index === this.pool.length - 1) {
          debug(
            `open connections: ${this.pool.length} of ${this.config.maxConnections}`,
          )
        }
      })
    }

    return connecting
  }

  protected removeConnection(connection: Connection | Promise<Connection>) {
    const index = this.pool.indexOf(connection)
    if (index !== -1) {
      this.pool.splice(index, 1)

      if (debug.enabled) {
        const poolSize = this.pool.length
        setImmediate(() => {
          if (poolSize === this.pool.length) {
            debug(
              `open connections: ${poolSize} of ${this.config.maxConnections}`,
            )
          }
        })
      }
    }
  }

  protected getConnection(
    signal?: AbortSignal,
  ): Connection | Promise<Connection> {
    const idleConnection = this.pool.find(
      conn => !isPromise(conn) && conn.status === ClientStatus.IDLE,
    )
    if (idleConnection) {
      return idleConnection
    }
    if (this.pool.length < this.config.maxConnections) {
      return this.addConnection(signal)
    }
    return new Promise((resolve, reject) => {
      signal?.throwIfAborted()
      this.backlog.push(err => {
        if (err) {
          reject(err)
        } else {
          resolve(this.getConnection(signal))
        }
      })
    })
  }

  /**
   * Connects to the database and initializes the connection pool.
   */
  async connect(dsn: string, signal?: AbortSignal) {
    if (this.dsn != null) {
      throw new Error('Postgres is already connected')
    }
    this.setDSN(dsn)
    if (this.config.minConnections > 0) {
      const firstConnection = this.addConnection(
        signal,
        Number.POSITIVE_INFINITY,
      )
      for (let i = 0; i < this.config.minConnections - 1; i++) {
        this.addConnection(signal, Number.POSITIVE_INFINITY)
      }
      await firstConnection
    }
  }

  /**
   * Executes a query on the database.
   */
  query<TRow extends Row = Row>(
    sql: string,
    params?: any[] | AbortSignal,
    signal?: AbortSignal,
  ): QueryPromise<Result<TRow>[]> {
    if (params && !isArray(params)) {
      signal = params
      params = undefined
    }

    const connection = this.getConnection(signal)
    const promise = this.dispatchQuery<TRow>(connection, sql, params, signal)

    return makeAsyncIterable(promise, () =>
      makeEventGenerator(connection, 'result'),
    )
  }

  protected async dispatchQuery<TRow extends Row = Row>(
    connection: Connection | Promise<Connection>,
    sql: string,
    params?: any[],
    signal?: AbortSignal,
  ): Promise<Result<TRow>[]> {
    signal?.throwIfAborted()

    if (isPromise(connection)) {
      // Only await the connection if necessary, so the connection status can
      // change to QUERY_WRITING as soon as possible.
      connection = await connection
    }

    try {
      signal?.throwIfAborted()

      const queryPromise = connection.query(sql, params)

      if (signal) {
        const cancel = () => connection.cancel()
        signal.addEventListener('abort', cancel)
        queryPromise.finally(() => {
          signal.removeEventListener('abort', cancel)
        })
      }

      return (await queryPromise) as Result<TRow>[]
    } finally {
      this.backlog.shift()?.()
    }
  }

  /**
   * Executes a query and returns an array of rows.
   *
   * You may explicitly type the rows using generics.
   */
  many<T extends Row>(
    sql: string,
    params?: any[] | AbortSignal,
    signal?: AbortSignal,
  ) {
    const promise = this.query(sql, params, signal)
    return transformAsyncIterable(
      promise,
      result => result.rows,
    ) as QueryPromise<T[]>
  }

  /**
   * Executes a query and returns a single row. You must add `LIMIT 1` yourself
   * or else the query will return more rows than needed.
   *
   * You may explicitly type the row using generics.
   */
  one<T extends Row>(
    sql: string,
    params?: any[] | AbortSignal,
    signal?: AbortSignal,
  ) {
    const promise = this.query(sql, params, signal)
    return transformAsyncIterable(
      promise,
      result => result.rows[0],
    ) as QueryPromise<T | undefined>
  }

  /**
   * Closes all connections in the pool.
   */
  async close() {
    if (this.dsn == null) {
      return
    }
    this.setDSN(null)
    const closing = Promise.all(
      this.pool.map(connection =>
        isPromise(connection)
          ? connection.then(c => c.close())
          : connection.close(),
      ),
    )
    this.pool = []
    if (this.backlog.length > 0) {
      const error = new Error('Postgres client was closed')
      this.backlog.forEach(fn => fn(error))
      this.backlog = []
    }
    await closing
  }

  private setDSN(dsn: string | null) {
    ;(this as { dsn: string | null }).dsn = dsn
  }
}

export interface QueryPromise<T>
  extends Promise<T>,
    AsyncIterable<T extends (infer U)[] ? U : T> {}

/**
 * Add the AsyncIterable protocol to an object.
 */
function makeAsyncIterable<T extends object, Item>(
  obj: T,
  asyncIterator: () => AsyncIterator<Item>,
): T & AsyncIterable<Item> {
  const result: any = obj
  result[Symbol.asyncIterator] = asyncIterator
  return result
}

/**
 * Converts an EventEmitter and event name pair into an async generator.
 */
async function* makeEventGenerator<T>(
  emitter: EventEmitter | Promise<EventEmitter>,
  eventName: string,
): AsyncGenerator<Awaited<T>, never, unknown> {
  if (isPromise(emitter)) {
    emitter = await emitter
  }
  while (true) {
    const { promise, resolve } = Promise.withResolvers<Awaited<T>>()
    emitter.on(eventName, resolve)
    try {
      yield promise
    } finally {
      emitter.off(eventName, resolve)
    }
  }
}

/**
 * Creates a new AsyncIterable with transformed values from the input
 * AsyncIterable.
 */
async function* transformAsyncIterable<T, U>(
  iterable: AsyncIterable<T>,
  transform: (value: T) => U | Promise<U>,
): AsyncIterable<U> {
  for await (const value of iterable) {
    yield await transform(value)
  }
}
