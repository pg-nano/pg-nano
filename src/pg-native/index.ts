import Libpq from 'libpq'
import { EventEmitter } from 'node:events'
import util from 'node:util'
import type { StrictEventEmitter } from 'strict-event-emitter-types'
import CopyStream from './copy-stream'
import { buildResult, type Result } from './result'

interface ClientEvents {
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
 */
export class Client extends ClientEventEmitter {
  protected pq: Libpq = null!
  protected idleTimeoutId: any = null
  declare readonly status: ClientStatus

  constructor(readonly idleTimeout: number = 30e3) {
    super()
    reset(castClient(this))
  }

  connect(dsn: string): Promise<void> {
    this.pq = new Libpq()
    return util.promisify(this.pq.connect.bind(this.pq))(dsn)
  }

  /**
   * Execute an unprepared query.
   */
  query(sql: string, params?: any[]) {
    const promise = dispatchQuery(this.pq, castClient(this), sql, params)
    if (Number.isFinite(this.idleTimeout)) {
      clearTimeout(this.idleTimeoutId)
      promise.finally(() => {
        this.idleTimeoutId = setTimeout(() => this.close(), this.idleTimeout)
      })
    }
    return promise
  }

  getCopyStream(): CopyStream {
    this.pq.setNonBlocking(true)
    stopReading(this.pq, castClient(this))
    return new CopyStream(this.pq)
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
    stopReading(this.pq, castClient(this))
    this.pq.finish()
    this.pq = null
    this.emit('close')
  }
}

export enum ClientStatus {
  IDLE = 0,
  QUERY_WRITING = 1,
  QUERY_READING = 2,
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

function reset(client: ClientState): void {
  client.status = ClientStatus.IDLE
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
  stopReading(pq, client)

  const promise = client.promise
  const success = pq.setNonBlocking(true)

  if (success) {
    const sent = Array.isArray(params)
      ? pq.sendQueryParams(sql, params)
      : pq.sendQuery(sql)

    if (sent) {
      await waitForDrain(pq)

      if (client.status !== ClientStatus.QUERY_READING) {
        client.status = ClientStatus.QUERY_READING
        pq.on('readable', (client.reader = () => read(pq, client)))
        pq.startReader()
      }
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

  reset(client)
}

function stopReading(pq: Libpq, client: ClientState) {
  if (client.status === ClientStatus.QUERY_READING) {
    client.status = ClientStatus.IDLE
    pq.stopReader()
    pq.removeListener('readable', client.reader)
  }
}

function waitForDrain(pq: Libpq) {
  return new Promise<void>(function check(resolve, reject) {
    const status = pq.flush()

    if (status !== 0) {
      if (status === -1) {
        return reject(pq.errorMessage())
      }

      // You cannot read & write on a socket at the same time.
      pq.writable(() => {
        check(resolve, reject)
      })
    }
  })
}

function processResult(pq: Libpq, client: ClientState): string {
  const resultStatus = pq.resultStatus()
  switch (resultStatus) {
    case 'PGRES_FATAL_ERROR':
      resolvePromise(client, new PgNativeError(pq.resultErrorMessage()))
      break

    case 'PGRES_TUPLES_OK':
    case 'PGRES_COMMAND_OK':
    case 'PGRES_EMPTY_QUERY': {
      client.results.push(buildResult(pq))
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
