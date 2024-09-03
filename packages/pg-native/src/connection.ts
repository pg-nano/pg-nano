import Libpq from '@pg-nano/libpq'
import { EventEmitter } from 'node:events'
import util from 'node:util'
import { isArray, isFunction, uid } from 'radashi'
import type { StrictEventEmitter } from 'strict-event-emitter-types'
import { debug } from './debug'
import { PgNativeError } from './error'
import { buildResult, type Result } from './result'
import type { SQLTemplate, SQLTemplateValue } from './template'

interface ConnectionEvents {
  result: (result: Result) => void
  notify: (msg: Libpq.NotifyMsg) => void
  close: () => void
}

const ConnectionEmitter =
  EventEmitter as unknown as new () => StrictEventEmitter<
    EventEmitter,
    ConnectionEvents
  >

type ConnectionEmitter = InstanceType<typeof ConnectionEmitter>

/**
 * The `pg-native` connection represents a single socket, connected to a
 * PostgreSQL server. It can only process one query at a time. There is no
 * protection against concurrent queries, and the connection won't work
 * correctly if more than one query is executed at the same time.
 *
 * You must call `connect` before you can execute queries. If you later call
 * `close`, you will have to call `connect` again before you can execute further
 * queries.
 *
 * Row streaming is possible through the `"result"` event. Results won't be
 * buffered if a `"result"` listener is added.
 *
 * The `"notify"` event is emitted when a NOTIFY message is received from the
 * database. This is useful for push-based data updates.
 */
export class Connection extends ConnectionEmitter {
  protected pq: Libpq = null!
  protected idleTimeoutId: any = null
  declare readonly status: ConnectionStatus

  constructor(readonly idleTimeout: number = 30e3) {
    super()
    reset(toConnectionState(this), ConnectionStatus.CLOSED)
  }

  async connect(dsn: string) {
    this.pq = new Libpq()
    await util.promisify(this.pq.connect.bind(this.pq))(dsn)
    setStatus(toConnectionState(this), ConnectionStatus.IDLE)
  }

  /**
   * Execute a dynamic query.
   */
  query<TResult = Result[]>(
    sql: SQLTemplate | QueryHook<TResult>,
  ): Promise<TResult> {
    const promise = sendQuery(this.pq, toConnectionState(this), sql)
    if (Number.isFinite(this.idleTimeout)) {
      clearTimeout(this.idleTimeoutId)
      promise.finally(() => {
        this.idleTimeoutId = setTimeout(() => this.close(), this.idleTimeout)
      })
    }
    return promise
  }

  /**
   * Cancel the current query.
   */
  cancel() {
    const result = this.pq.cancel()
    if (result !== true) {
      throw new Error(result)
    }
  }

  /**
   * Close the database connection.
   */
  close() {
    stopReading(this.pq, toConnectionState(this), ConnectionStatus.CLOSED)
    this.pq.finish()
    this.pq = null
    this.emit('close')
  }
}

export enum ConnectionStatus {
  IDLE = 0,
  QUERY_WRITING = 1,
  QUERY_READING = 2,
  CLOSED = 3,
}

interface ConnectionState {
  status: ConnectionStatus
  reader: (() => void) | null
  results: Result[]
  promise: Promise<Result[]>
  resolve: (response: Result[]) => void
  reject: (error: Error) => void
}

function toConnectionState(
  conn: Connection,
): ConnectionState & ConnectionEmitter {
  return conn as any
}

function setStatus(conn: ConnectionState, newStatus: ConnectionStatus): void {
  if (!__DEV__ || conn.status !== newStatus) {
    conn.status = newStatus
    if (__DEV__) {
      debug(`connection status: ${ConnectionStatus[newStatus]}`)
    }
  }
}

function reset(conn: ConnectionState, newStatus: ConnectionStatus): void {
  setStatus(conn, newStatus)
  conn.reader = null
  conn.results = []
  conn.promise = new Promise((resolve, reject) => {
    conn.resolve = resolve
    conn.reject = reject
  })
}

/**
 * Hook into the query execution process. Useful for `libpq` tasks beyond
 * executing a dynamic query.
 *
 * If the function returns a promise, the query execution will wait for the
 * promise to resolve before continuing.
 */
export type QueryHook<TResult> = (
  pq: Libpq,
) => boolean | (() => Promise<TResult>)

/**
 * Sends a query to libpq and waits for it to finish writing query text to the
 * socket.
 */
async function sendQuery<TResult = Result[]>(
  pq: Libpq,
  conn: ConnectionState & ConnectionEmitter,
  sql: SQLTemplate | QueryHook<TResult>,
): Promise<TResult> {
  stopReading(pq, conn, ConnectionStatus.QUERY_WRITING)

  let debugId: string | undefined

  const promise = conn.promise
  const success = pq.setNonBlocking(true)

  if (success) {
    let sent: boolean | (() => Promise<TResult>)
    if (isFunction(sql)) {
      sent = sql(pq)
    } else {
      const query = stringifyTemplate(sql, pq)

      if (__DEV__) {
        debugId = uid(8)
        debug(`query:${debugId} writing`, { query })
      }

      sent = pq.sendQuery(query)
    }

    if (sent) {
      await waitForDrain(pq)

      if (isFunction(sent)) {
        try {
          conn.results = (await sent()) as any
          resolvePromise(conn)
        } catch (error) {
          resolvePromise(conn, error)
        }
      } else {
        setStatus(conn, ConnectionStatus.QUERY_READING)
        pq.once('readable', (conn.reader = () => read(pq, conn)))
        pq.startReader()
      }
    } else {
      resolvePromise(conn, new PgNativeError(pq.errorMessage()))
    }
  } else {
    resolvePromise(
      conn,
      new PgNativeError('Unable to set non-blocking to true'),
    )
  }

  if (__DEV__) {
    promise.then(
      results => {
        debug(`query:${debugId} results`, results)
      },
      error => {
        debug(`query:${debugId} error`, error)
      },
    )
  }

  return promise as Promise<TResult>
}

function stringifyTemplate(template: SQLTemplate, pq: Libpq) {
  let sql = ''
  for (let i = 0; i < template.strings.length; i++) {
    sql += template.strings[i]
    if (i < template.values.length) {
      sql += stringifyTemplateValue(template.values[i], pq)
    }
  }
  return sql
}

function stringifyTemplateValue(arg: SQLTemplateValue, pq: Libpq) {
  if (isArray(arg)) {
    return arg.map(value => stringifyTemplateValue(value, pq)).join(', ')
  }
  if ('strings' in arg) {
    return stringifyTemplate(arg, pq)
  }
  switch (arg.type) {
    case 'id':
      return pq.escapeIdentifier(arg.value)
    case 'val':
      return pq.escapeLiteral(arg.value)
    case 'raw':
      return arg.value
  }
}

// called when libpq is readable
function read(pq: Libpq, conn: ConnectionState & ConnectionEmitter): void {
  // read waiting data from the socket
  // e.g. clear the pending 'select'
  if (!pq.consumeInput()) {
    resolvePromise(conn, new PgNativeError(pq.errorMessage()))
    return
  }

  // check if there is still outstanding data
  // if so, wait for it all to come in
  if (pq.isBusy()) {
    return
  }

  // load our result object
  while (pq.getResult()) {
    const resultStatus = processResult(pq, conn)

    // if the command initiated copy mode we need to break out of the read loop
    // so a substream can begin to read copy data
    if (
      resultStatus === 'PGRES_COPY_BOTH' ||
      resultStatus === 'PGRES_COPY_OUT'
    ) {
      break
    }

    // if reading multiple results, sometimes the following results might cause
    // a blocking read. in this scenario yield back off the reader until libpq is readable
    if (pq.isBusy()) {
      return
    }
  }

  resolvePromise(conn)

  let notice = pq.notifies()
  while (notice) {
    conn.emit('notify', notice)
    notice = this.pq.notifies()
  }
}

function resolvePromise(conn: ConnectionState, error?: PgNativeError) {
  if (error) {
    conn.reject(error)
  } else {
    conn.resolve(conn.results)
  }

  reset(conn, ConnectionStatus.IDLE)
}

function stopReading(
  pq: Libpq,
  conn: ConnectionState,
  newStatus: ConnectionStatus,
) {
  if (conn.status === ConnectionStatus.QUERY_READING) {
    pq.stopReader()
    pq.removeListener('readable', conn.reader)
  }
  setStatus(conn, newStatus)
}

function waitForDrain(pq: Libpq) {
  return new Promise<void>(function check(resolve, reject) {
    switch (pq.flush()) {
      case 0:
        resolve()
        break
      case -1:
        reject(pq.errorMessage())
        break
      default:
        // You cannot read & write on a socket at the same time.
        pq.writable(() => {
          check(resolve, reject)
        })
    }
  })
}

function processResult(
  pq: Libpq,
  conn: ConnectionState & ConnectionEmitter,
): string {
  const resultStatus = pq.resultStatus()
  switch (resultStatus) {
    case 'PGRES_FATAL_ERROR':
      resolvePromise(conn, new PgNativeError(pq.resultErrorMessage()))
      break

    case 'PGRES_TUPLES_OK':
    case 'PGRES_COMMAND_OK':
    case 'PGRES_EMPTY_QUERY': {
      const result = buildResult(pq)
      if (conn.listenerCount('result')) {
        conn.emit('result', result)
      } else {
        conn.results.push(result)
      }
      break
    }

    case 'PGRES_COPY_OUT':
    case 'PGRES_COPY_BOTH':
      break

    default:
      console.warn(`[pg-native] Unrecognized result status: ${resultStatus}`)
      break
  }
  return resultStatus
}
