import { isPromise } from 'node:util/types'
import { sleep } from 'radashi'
import type { Field, Result, Row } from './pg-native/build-result.js'
import { ClientStatus, Client as Connection } from './pg-native/index.js'

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

export class Postgres {
  protected pool: (Connection | Promise<Connection>)[] = []
  protected backlog: (() => void)[] = []

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

  protected addConnection(
    idleTimeout = this.config.idleTimeout,
  ): Promise<Connection> {
    const connection = new Connection(idleTimeout)
    const connecting = this.connectWithRetry(connection).then(() => {
      const index = this.pool.indexOf(connecting)
      return (this.pool[index] = connection)
    })
    this.pool.push(connecting)
    return connecting
  }

  protected async connectWithRetry(
    connection: Connection,
    retries = Math.max(this.config.maxRetries, 0),
    delay = Math.max(this.config.initialRetryDelay, 0),
  ): Promise<void> {
    if (!this.dsn) {
      throw new Error('Postgres is not connected')
    }
    try {
      await connection.connect(this.dsn)
    } catch (error) {
      if (retries > 0) {
        if (delay > 0) {
          await sleep(delay)
        }
        return this.connectWithRetry(
          connection,
          retries - 1,
          Math.min(delay * 2, this.config.maxRetryDelay),
        )
      }
      throw error
    }
  }

  protected async getConnection(): Promise<Connection> {
    const idleConnection = this.pool.find(
      conn => !isPromise(conn) && conn.status === ClientStatus.IDLE,
    )
    if (idleConnection) {
      return idleConnection
    }
    if (this.pool.length < this.config.maxConnections) {
      return this.addConnection()
    }
    return new Promise(resolve => {
      this.backlog.push(() => {
        resolve(this.getConnection())
      })
    })
  }

  /**
   * Connects to the database and initializes the connection pool.
   */
  async connect(dsn: string) {
    ;(this as { dsn: string }).dsn = dsn

    if (this.config.minConnections > 0) {
      const firstConnection = this.addConnection(Number.POSITIVE_INFINITY)
      for (let i = 0; i < this.config.minConnections - 1; i++) {
        this.addConnection(Number.POSITIVE_INFINITY)
      }
      await firstConnection
    }
  }

  /**
   * Executes a query on the database.
   */
  async query(sql: string, params?: any[]) {
    const connection = await this.getConnection()
    return connection.query(sql, params).finally(() => {
      this.backlog.shift()?.()
    })
  }
}
