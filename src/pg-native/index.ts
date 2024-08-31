import Libpq from 'libpq'
import { EventEmitter } from 'node:events'
import util from 'node:util'
import { uid } from 'radashi'
import type { StrictEventEmitter } from 'strict-event-emitter-types'
import { debug } from './debug'
import { buildResult, type Result } from './result'

interface ClientEvents {
  result: (result: Result) => void
  notify: (msg: Libpq.NotifyMsg) => void
  close: () => void
}

const ClientEventEmitter =
  EventEmitter as unknown as new () => StrictEventEmitter<
    EventEmitter,
    ClientEvents
  >

type ClientEventEmitter = InstanceType<typeof ClientEventEmitter>

/**
 * The `pg-native` client represents a single socket, connected to a PostgreSQL
 * server. It can only process one query at a time. There is no protection
 * against concurrent queries, and the client will not work correctly if more
 * than one query is executed at the same time.
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
export class Client extends ClientEventEmitter {
  protected pq: Libpq = null!
  protected idleTimeoutId: any = null
  declare readonly status: ClientStatus

  constructor(readonly idleTimeout: number = 30e3) {
    super()
    reset(castClient(this), ClientStatus.CLOSED)
  }

  async connect(dsn: string) {
    this.pq = new Libpq()
    await util.promisify(this.pq.connect.bind(this.pq))(dsn)
    setStatus(castClient(this), ClientStatus.IDLE)
  }

  /**
   * Execute an unprepared query.
   */
  query(sql: string, params?: any[]) {
    let debugId: string | undefined
    if (debug.enabled) {
      debugId = uid(8)
      debug(`query:${debugId} dispatching`, { sql, params })
    }
    const promise = dispatchQuery(this.pq, castClient(this), sql, params)
    if (Number.isFinite(this.idleTimeout)) {
      clearTimeout(this.idleTimeoutId)
      promise.finally(() => {
        this.idleTimeoutId = setTimeout(() => this.close(), this.idleTimeout)
      })
    }
    if (debug.enabled) {
      promise.then(
        results => {
          debug(`query:${debugId} results`, results)
        },
        error => {
          debug(`query:${debugId} error`, error)
        },
      )
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

  escapeLiteral(value: string): string {
    return this.pq.escapeLiteral(value)
  }

  escapeIdentifier(value: string): string {
    return this.pq.escapeIdentifier(value)
  }

  /**
   * Close the database connection.
   */
  close() {
    stopReading(this.pq, castClient(this), ClientStatus.CLOSED)
    this.pq.finish()
    this.pq = null
    this.emit('close')
  }
}

export enum ClientStatus {
  IDLE = 0,
  QUERY_WRITING = 1,
  QUERY_READING = 2,
  CLOSED = 3,
}

interface ClientState {
  status: ClientStatus
  reader: (() => void) | null
  results: Result[]
  promise: Promise<Result[]>
  resolve: (response: Result[]) => void
  reject: (error: Error) => void
}

function castClient(client: Client): ClientState & ClientEventEmitter {
  return client as any
}

function setStatus(client: ClientState, newStatus: ClientStatus): void {
  if (!debug.enabled || client.status !== newStatus) {
    client.status = newStatus
    if (debug.enabled) {
      debug(`client status: ${ClientStatus[newStatus]}`)
    }
  }
}

function reset(client: ClientState, newStatus: ClientStatus): void {
  setStatus(client, newStatus)
  client.reader = null
  client.results = []
  client.promise = new Promise((resolve, reject) => {
    client.resolve = resolve
    client.reject = reject
  })
}

/**
 * Sends a query to libpq and waits for it to finish writing query text to the
 * socket.
 */
async function dispatchQuery(
  pq: Libpq,
  client: ClientState & ClientEventEmitter,
  sql: string,
  params?: any[],
) {
  stopReading(pq, client, ClientStatus.QUERY_WRITING)

  const promise = client.promise
  const success = pq.setNonBlocking(true)

  if (success) {
    const sent = Array.isArray(params)
      ? pq.sendQueryParams(sql, params)
      : pq.sendQuery(sql)

    if (sent) {
      await waitForDrain(pq)

      setStatus(client, ClientStatus.QUERY_READING)
      pq.on('readable', (client.reader = () => read(pq, client)))
      pq.startReader()
    } else {
      resolvePromise(client, new PgNativeError(pq.errorMessage()))
    }
  } else {
    resolvePromise(
      client,
      new PgNativeError('Unable to set non-blocking to true'),
    )
  }
  return promise
}

// called when libpq is readable
function read(pq: Libpq, client: ClientState & ClientEventEmitter): void {
  // read waiting data from the socket
  // e.g. clear the pending 'select'
  if (!pq.consumeInput()) {
    resolvePromise(client, new PgNativeError(pq.errorMessage()))
    return
  }

  // check if there is still outstanding data
  // if so, wait for it all to come in
  if (pq.isBusy()) {
    return
  }

  // load our result object
  while (pq.getResult()) {
    const resultStatus = processResult(pq, client)

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

  resolvePromise(client)

  let notice = pq.notifies()
  while (notice) {
    client.emit('notify', notice)
    notice = this.pq.notifies()
  }
}

function resolvePromise(client: ClientState, error?: PgNativeError) {
  if (error) {
    client.reject(error)
  } else {
    client.resolve(client.results)
  }

  reset(client, ClientStatus.IDLE)
}

function stopReading(pq: Libpq, client: ClientState, newStatus: ClientStatus) {
  if (client.status === ClientStatus.QUERY_READING) {
    pq.stopReader()
    pq.removeListener('readable', client.reader)
  }
  setStatus(client, newStatus)
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
  client: ClientState & ClientEventEmitter,
): string {
  const resultStatus = pq.resultStatus()
  switch (resultStatus) {
    case 'PGRES_FATAL_ERROR':
      resolvePromise(client, new PgNativeError(pq.resultErrorMessage()))
      break

    case 'PGRES_TUPLES_OK':
    case 'PGRES_COMMAND_OK':
    case 'PGRES_EMPTY_QUERY': {
      const result = buildResult(pq)
      if (client.listenerCount('result')) {
        client.emit('result', result)
      } else {
        client.results.push(result)
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

export class PgNativeError extends Error {
  constructor(message: string) {
    super('[pg-native] ' + message)
    this.name = 'PgNativeError'
  }
}
