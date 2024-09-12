import createDebug from 'debug'
import { isPromise } from 'node:util/types'
import {
  Connection,
  ConnectionStatus,
  stringifyTemplate,
  type QueryHook,
  type Result,
  type Row,
  type SQLTemplate,
} from 'pg-native'
import { sleep } from 'radashi'
import { ConnectionError, QueryError } from './error.js'
import { Query, type QueryOptions } from './query'

const debug = /** @__PURE__ */ createDebug('pg-nano')

export interface ClientOptions {
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
 * Queries are both promises and async iterables.
 *
 * Note that `maxConnections` defaults to 100, which assumes you only have one
 * application server. If you have multiple application servers, you probably
 * want to lower this value by dividing it by the number of application servers.
 */
export class Client {
  protected pool: (Connection | Promise<Connection>)[] = []
  protected backlog: ((err?: Error) => void)[] = []

  readonly dsn: string | null = null
  readonly config: Readonly<ClientOptions>

  constructor({
    minConnections = 1,
    maxConnections = 100,
    initialRetryDelay = 250,
    maxRetryDelay = 10e3,
    maxRetries = Number.POSITIVE_INFINITY,
    idleTimeout = 30e3,
  }: Partial<ClientOptions> = {}) {
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
      throw new ConnectionError('Postgres is not connected')
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

    if (process.env.NODE_ENV !== 'production' && debug.enabled) {
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

      if (process.env.NODE_ENV !== 'production' && debug.enabled) {
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
      conn => !isPromise(conn) && conn.status === ConnectionStatus.IDLE,
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
      throw new ConnectionError('Postgres is already connected')
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
    return this
  }

  /**
   * Execute one or more commands.
   */
  query<TRow extends Row = Row, TIteratorResult = Result<TRow>>(
    commands: SQLTemplate,
    transform?: (result: Result<TRow>) => TIteratorResult | TIteratorResult[],
  ) {
    return new Query<Result<TRow>[], TIteratorResult>(this, commands, transform)
  }

  protected async dispatchQuery<
    TRow extends Row = Row,
    TResult = Result<TRow>[],
  >(
    connection: Connection | Promise<Connection>,
    commands: SQLTemplate | QueryHook<TResult>,
    signal?: AbortSignal,
    resultParser?: (result: Result) => void,
    singleRowMode?: boolean,
  ): Promise<TResult> {
    signal?.throwIfAborted()

    if (isPromise(connection)) {
      // Only await the connection if necessary, so the connection status can
      // change to QUERY_WRITING as soon as possible.
      connection = await connection
    }

    try {
      signal?.throwIfAborted()

      const queryPromise = connection.query(
        commands,
        resultParser,
        singleRowMode,
      )

      if (signal) {
        const cancel = () => connection.cancel()
        signal.addEventListener('abort', cancel)
        queryPromise.finally(() => {
          signal.removeEventListener('abort', cancel)
        })
      }

      return await queryPromise
    } finally {
      this.backlog.shift()?.()
    }
  }

  /**
   * Create a query that resolves with an array of rows (or stream one row at a
   * time, when used as an async iterable).
   *
   * - You may define the row type via this method's type parameter.
   * - Your SQL template may contain multiple commands, but they run
   *   sequentially. The result sets are concatenated.
   */
  queryRowList<TRow extends Row>(
    command: SQLTemplate,
    options?: QueryOptions,
  ): Query<TRow[]> {
    const query = this.query<TRow, TRow>(command, result => result.rows)
    return query.withOptions({
      ...options,
      resolve: results =>
        results.flatMap(result => {
          return result.rows
        }),
    }) as any
  }

  /**
   * Create a query that resolves with an array of values, where each value is
   * derived from the only column of each row in the result set.
   *
   * - You may define the column type via this method's type parameter.
   * - Your SQL template may contain multiple commands, but they run
   *   sequentially. The result sets are concatenated.
   */
  queryValueList<T>(command: SQLTemplate, options?: QueryOptions): Query<T[]> {
    const query = this.query(command)
    return query.withOptions({
      ...options,
      resolve: results =>
        results.flatMap(result => {
          if (result.fields.length !== 1) {
            throw new QueryError(
              'Expected 1 field, got ' + result.fields.length,
            )
          }
          return result.rows.map(row => row[result.fields[0].name])
        }),
    }) as any
  }

  /**
   * Create a query that resolves with a single row. This assumes only one
   * command exists in the given query. If you don't limit the results, the
   * promise will be rejected when more than one row is received.
   *
   * You may define the row type using generics.
   */
  async queryRow<TRow extends Row>(
    command: SQLTemplate,
    options?: QueryOptions,
  ): Promise<TRow | undefined> {
    const [result] = await this.query<TRow>(command).withOptions(options)
    if (result.rows.length > 1) {
      throw new QueryError('Expected at most 1 row, got ' + result.rows.length)
    }
    return result.rows[0]
  }

  /**
   * Create a query that resolves with a single value, derived from the single
   * column of the single row of the result set.
   *
   * If you're not sure if the result set could be empty, you'd better include
   * `undefined` in the result type.
   */
  async queryValue<T>(
    command: SQLTemplate,
    options?: QueryOptions,
  ): Promise<T> {
    const [result] = await this.query(command).withOptions(options)
    if (result.rows.length > 1) {
      throw new QueryError('Expected at most 1 row, got ' + result.rows.length)
    }
    if (result.fields.length !== 1) {
      throw new QueryError('Expected 1 field, got ' + result.fields.length)
    }
    return result.rows[0]?.[result.fields[0].name] as T
  }

  /**
   * Create a proxy object that allows you to call routines from the given
   * schema object as methods on the client instance. The original methods and
   * properties of the client are preserved, but routines of the same name take
   * precedence over them.
   *
   * The easiest way to use `withSchema` is by importing your `sql/schema.ts`
   * file as a namespace and passing it to this method.
   *
   * @example
   * ```ts
   * import * as schema from './sql/schema.js'
   * const client = new Client().withSchema(schema)
   * await client.myPostgresFunc(1, 2, 3)
   * ```
   */
  withSchema<TSchema extends object>(routines: TSchema): ClientProxy<TSchema> {
    return new Proxy(this, {
      get(client, key) {
        if (key in routines) {
          // biome-ignore lint/complexity/noBannedTypes:
          return (routines[key as keyof TSchema] as Function).bind(null, client)
        }
        return client[key as keyof Client]
      },
    }) as any
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
      const error = new ConnectionError('Postgres client was closed')
      this.backlog.forEach(fn => fn(error))
      this.backlog = []
    }
    await closing
  }

  /**
   * Returns a stringified version of the template. It's async because it uses
   * libpq's escaping functions.
   */
  async stringify(template: SQLTemplate, options: { reindent?: boolean } = {}) {
    // Since we're not sending anything to the server, it's perfectly fine to
    // use a non-idle connection.
    const connection = await (this.pool[0] || this.getConnection())
    // biome-ignore lint/complexity/useLiteralKeys: Protected access
    return stringifyTemplate(template, connection['pq'], options)
  }

  private setDSN(dsn: string | null) {
    ;(this as { dsn: string | null }).dsn = dsn
  }
}

export type ClientProxy<TSchema extends object> = Omit<
  Client,
  keyof TSchema
> & {
  [K in keyof TSchema]: TSchema[K] extends (
    client: Client,
    ...args: infer TArgs
  ) => infer TResult
    ? (...args: TArgs) => TResult
    : never
}
