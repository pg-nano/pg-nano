import { isPromise } from 'node:util/types'
import {
  baseTypeParsers,
  Connection,
  ConnectionStatus,
  createTextParser,
  parseConnectionString,
  QueryType,
  renderTemplateValue,
  stringifyConnectOptions,
  type CommandResult,
  type ConnectOptions,
  type QueryHook,
  type Row,
  type SQLTemplate,
  type SQLTemplateValue,
  type TextParser,
} from 'pg-native'
import { isString, noop, sleep } from 'radashi'
import { FieldCase } from './casing.js'
import { importCustomTypeParsers } from './data/composite.js'
import { debug } from './debug.js'
import { ConnectionError } from './error.js'
import { Query } from './query.js'

export interface ClientConfig {
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

  /**
   * Fixes the casing of field names in generated types.
   *
   * - `camel` will convert snake case field names to camel case.
   * - `preserve` will leave field names as is.
   *
   * This should match the `generate.fieldCase` option in your pg-nano config.
   *
   * @default FieldCase.camel
   */
  fieldCase: FieldCase

  /**
   * Executes the given SQL on each connection, immediately after it is
   * established, before any queries are run.
   */
  postConnectDDL: SQLTemplate | null

  /**
   * Text parsers for custom types. This can be used to override or extend the
   * default text parsers. Note that pg-nano will automatically generate type
   * parsers for certain custom types discovered through introspection, such as
   * user-defined composite types.
   */
  textParsers: Record<number, TextParser> | null

  /**
   * Pre-allocate an `Error` for each query, thereby capturing a stack trace
   * from where the query was constructed. This is useful when an error isn't
   * providing an actionable stack trace, but it's not recommended for
   * production due to performance impact.
   *
   * @default false
   */
  debug: boolean
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
  protected init: Promise<void> | null = null
  protected parseText: ((value: string, dataTypeID: number) => unknown) | null =
    null

  dsn: string | null = null
  readonly config: Readonly<ClientConfig>

  constructor({
    minConnections = 1,
    maxConnections = 100,
    initialRetryDelay = 250,
    maxRetryDelay = 10e3,
    maxRetries = Number.POSITIVE_INFINITY,
    idleTimeout = 30e3,
    fieldCase = FieldCase.camel,
    postConnectDDL = null,
    textParsers = null,
    debug = false,
  }: Partial<ClientConfig> = {}) {
    this.config = {
      minConnections,
      maxConnections,
      initialRetryDelay,
      maxRetryDelay,
      maxRetries,
      idleTimeout,
      fieldCase,
      postConnectDDL,
      textParsers,
      debug,
    }
  }

  protected async connectWithRetry(
    connection: Connection,
    signal?: AbortSignal,
    retries = Math.max(this.config.maxRetries, 0),
    delay = Math.max(this.config.initialRetryDelay, 0),
  ): Promise<string> {
    const { dsn } = this
    if (dsn == null) {
      throw new ConnectionError('Postgres client was closed')
    }
    signal?.throwIfAborted()
    try {
      await connection.connect(dsn)
      return dsn
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
      this.dsn = null
      throw error
    }
  }

  protected async resolveTextParsers(dsn: string, connection: Connection) {
    const {
      host = process.env.PGHOST ?? 'localhost',
      port = process.env.PGPORT ?? 5432,
      dbname = process.env.PGDATABASE ?? 'postgres',
    } = parseConnectionString(dsn)

    // Assume no custom types have been created in the `postgres` database.
    if (dbname === 'postgres') {
      return
    }

    // Generate type parsers for custom types discovered by introspection. This
    // can't be done at compile-time, since it depends on type OIDs, which are
    // not stable across Postgres databases.
    const { default: customTypeParsers } = await importCustomTypeParsers(
      connection,
      host,
      port,
      dbname,
    )

    if (this.dsn === dsn) {
      this.parseText = createTextParser({
        ...baseTypeParsers,
        ...customTypeParsers,
        ...this.config.textParsers,
      })
    }
  }

  protected addConnection(
    signal?: AbortSignal,
    idleTimeout = this.config.idleTimeout,
  ): Promise<Connection> {
    const connection = new Connection(idleTimeout)

    const connecting = this.connectWithRetry(connection, signal)
      .then(async dsn => {
        if (!this.parseText) {
          await (this.init ??= this.resolveTextParsers(dsn, connection).finally(
            () => {
              this.init = null
            },
          ))
        }

        if (this.config.postConnectDDL) {
          await connection.query(QueryType.void, this.config.postConnectDDL)
        }

        const index = this.pool.indexOf(connecting)
        this.pool[index] = connection

        connection.on('close', () => {
          this.removeConnection(connection)
        })

        return connection
      })
      .catch(error => {
        this.removeConnection(connecting)
        throw error
      })

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
  async connect(target: string | ConnectOptions, signal?: AbortSignal) {
    if (this.dsn != null) {
      throw new ConnectionError('Postgres is already connected')
    }
    this.dsn = isString(target) ? target : stringifyConnectOptions(target)
    if (this.config.minConnections > 0) {
      // Wait for the first connection to be established before adding more.
      await this.addConnection(signal, Number.POSITIVE_INFINITY)
      for (let i = 0; i < this.config.minConnections - 1; i++) {
        this.addConnection(signal, Number.POSITIVE_INFINITY).catch(noop)
      }
    }
    return this
  }

  /**
   * Execute one or more commands.
   */
  query<TRow extends Row>(
    input: SQLTemplate | QueryHook<CommandResult<TRow>[]>,
    options?: Query.Options | null,
  ): Query<CommandResult<TRow>[]> {
    return new Query(this, QueryType.full, input, options)
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
    input: SQLTemplate | QueryHook<TRow[]>,
    options?: Query.Options | null,
  ): Query<TRow[]> {
    return new Query(this, QueryType.row, input, options)
  }

  /**
   * Create a query that resolves with an array of values, where each value is
   * derived from the only column of each row in the result set.
   *
   * - You may define the column type via this method's type parameter.
   * - Your SQL template may contain multiple commands, but they run
   *   sequentially. The result sets are concatenated.
   */
  queryValueList<T>(
    input: SQLTemplate | QueryHook<T[]>,
    options?: Query.Options | null,
  ): Query<T[]> {
    return new Query(this, QueryType.value, input, options)
  }

  /**
   * Create a query that resolves with a single row or null. This assumes only
   * one command exists in the given query. If you don't limit the results, the
   * promise will be rejected when more than one row is received.
   *
   * You may define the row type using generics.
   */
  queryRowOrNull<TRow extends Row>(
    input: SQLTemplate | QueryHook<TRow[]>,
    options?: Query.Options | null,
  ): Query<TRow | null, TRow> {
    return new Query(this, QueryType.row, input, options, '[0,1]')
  }

  /**
   * Like `queryRowOrNull`, but throws an error if the result is null.
   */
  queryRow<TRow extends Row>(
    input: SQLTemplate | QueryHook<TRow[]>,
    options?: Query.Options | null,
  ): Query<TRow> {
    return new Query(this, QueryType.row, input, options, '[1,1]')
  }

  /**
   * Create a query that resolves with a single value, derived from the single
   * column of the single row of the result set.
   *
   */
  queryValueOrNull<T>(
    input: SQLTemplate | QueryHook<T[]>,
    options?: Query.Options | null,
  ): Query<T | null, T> {
    return new Query(this, QueryType.value, input, options, '[0,1]')
  }

  /**
   * Like `queryValueOrNull`, but throws an error if the result is null.
   */
  queryValue<T>(
    input: SQLTemplate | QueryHook<T[]>,
    options?: Query.Options | null,
  ): Query<T, T> {
    return new Query(this, QueryType.value, input, options, '[1,1]')
  }

  // Signals an idle connection.
  protected onQueryFinished() {
    this.backlog.shift()?.()
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
  withSchema<TSchema extends object>(schema: TSchema): ClientProxy<TSchema> {
    return new Proxy(this, {
      get(client, key) {
        if (key in schema) {
          return (schema[key as keyof TSchema] as Function).bind(null, client)
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
    this.dsn = null
    this.init = null
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
    await closing.catch(noop)
    this.parseText = null
  }

  /**
   * Returns a stringified version of the template. It's async because it uses
   * libpq's escaping functions.
   */
  stringify(input: SQLTemplateValue, options: { reindent?: boolean } = {}) {
    // Since we're not sending anything to the server, it's perfectly fine to
    // use a non-idle connection.
    const connection = this.pool[0]
    if (!connection || isPromise(connection)) {
      throw new ConnectionError('Postgres is not connected')
    }
    // biome-ignore lint/complexity/useLiteralKeys: Protected access
    return renderTemplateValue(input, connection['pq'], options)
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
