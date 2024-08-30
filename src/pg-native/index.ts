import Libpq from 'libpq'
import assert from 'node:assert'
import { EventEmitter } from 'node:events'
import types from 'pg-types'
import buildResult from './build-result'
import CopyStream from './copy-stream'

class Client extends EventEmitter {
  private pq: Libpq
  private _reading: boolean
  private _types: any
  private arrayMode: boolean
  private _resultCount: number
  private _rows: any
  private _results: any
  private _queryCallback: Function | undefined
  private _queryError: Error | undefined

  constructor(config: any = {}) {
    super()
  this.pq = new Libpq()
  this._reading = false
  this._read = this._read.bind(this)

    // allow custom type conversion to be passed in
  this._types = config.types || types

  // allow config to specify returning results
  // as an array of values instead of a hash
  this.arrayMode = config.arrayMode || false
  this._resultCount = 0
  this._rows = undefined
  this._results = undefined

  // lazy start the reader if notifications are listened for
    // this way if you only run sync queries you won't block
  // the event loop artificially
    this.on('newListener', (event: string) => {
      if (event === 'notification') {
    this._startReading()
      }
  })

  this.on('result', this._onResult.bind(this))
  this.on('readyForQuery', this._onReadyForQuery.bind(this))
}

  connect(params: any, cb: Function): void {
  this.pq.connect(params, cb)
}

  connectSync(params: any): void {
  this.pq.connectSync(params)
}

  query(text: string, values: any[] | Function, cb?: Function): void {
    let queryFn: () => boolean

  if (typeof values === 'function') {
      cb = values as Function
  }

  if (Array.isArray(values)) {
      queryFn = () => this.pq.sendQueryParams(text, values as any[])
  } else {
    queryFn = () => this.pq.sendQuery(text)
  }

    this._dispatchQuery(this.pq, queryFn, (err: Error | null) => {
    if (err) {
        return cb!(err)
    }

      this._awaitResult(cb!)
  })
}

  prepare(
    statementName: string,
    text: string,
    nParams: number,
    cb: Function,
  ): void {
  const fn = () => this.pq.sendPrepare(statementName, text, nParams)

    this._dispatchQuery(this.pq, fn, (err: Error | null) => {
    if (err) {
      return cb(err)
    }
    this._awaitResult(cb)
  })
}

  execute(statementName: string, parameters: any[], cb: Function): void {
  const fn = () => this.pq.sendQueryPrepared(statementName, parameters)

    this._dispatchQuery(this.pq, fn, (err: Error | null) => {
    if (err) {
      return cb(err)
    }
    this._awaitResult(cb)
  })
}

  getCopyStream(): CopyStream {
  this.pq.setNonBlocking(true)
  this._stopReading()
  return new CopyStream(this.pq)
}

// cancel a currently executing query
  cancel(cb: Function): void {
  assert(cb, 'Callback is required')
  // result is either true or a string containing an error
  const result = this.pq.cancel()
    setImmediate(() => {
      cb(result === true ? undefined : new Error(result as string))
  })
}

  querySync(text: string, values?: any[]): any[] {
  if (values) {
    this.pq.execParams(text, values)
  } else {
    this.pq.exec(text)
  }

  throwIfError(this.pq)
  const result = buildResult(this.pq, this._types, this.arrayMode)
  return result.rows
}

  prepareSync(statementName: string, text: string, nParams: number): void {
  this.pq.prepare(statementName, text, nParams)
  throwIfError(this.pq)
}

  executeSync(statementName: string, parameters: any[]): any[] {
  this.pq.execPrepared(statementName, parameters)
  throwIfError(this.pq)
  return buildResult(this.pq, this._types, this.arrayMode).rows
}

  escapeLiteral(value: string): string {
  return this.pq.escapeLiteral(value)
}

  escapeIdentifier(value: string): string {
  return this.pq.escapeIdentifier(value)
}

  end(cb?: Function): void {
  this._stopReading()
  this.pq.finish()
  if (cb) {
    setImmediate(cb)
  }
}

  private _readError(message?: string): void {
  const err = new Error(message || this.pq.errorMessage())
  this.emit('error', err)
}

  private _stopReading(): void {
  if (!this._reading) {
    return
  }
  this._reading = false
  this.pq.stopReader()
  this.pq.removeListener('readable', this._read)
}

  private _consumeQueryResults(pq: Libpq): any {
  return buildResult(pq, this._types, this.arrayMode)
}

  private _emitResult(pq: Libpq): string {
  const status = pq.resultStatus()
  switch (status) {
    case 'PGRES_FATAL_ERROR':
      this._queryError = new Error(this.pq.resultErrorMessage())
      break

    case 'PGRES_TUPLES_OK':
    case 'PGRES_COMMAND_OK':
    case 'PGRES_EMPTY_QUERY':
      const result = this._consumeQueryResults(this.pq)
      this.emit('result', result)
      break

    case 'PGRES_COPY_OUT':
      case 'PGRES_COPY_BOTH':
      break

    default:
      this._readError('unrecognized command status: ' + status)
      break
  }
  return status
}

// called when libpq is readable
  private _read(): void {
  const pq = this.pq
  // read waiting data from the socket
  // e.g. clear the pending 'select'
  if (!pq.consumeInput()) {
    // if consumeInput returns false
    // than a read error has been encountered
    return this._readError()
  }

  // check if there is still outstanding data
  // if so, wait for it all to come in
  if (pq.isBusy()) {
    return
  }

  // load our result object
  while (pq.getResult()) {
    const resultStatus = this._emitResult(this.pq)

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

  this.emit('readyForQuery')

  let notice = this.pq.notifies()
  while (notice) {
    this.emit('notification', notice)
    notice = this.pq.notifies()
  }
}

// ensures the client is reading and
// everything is set up for async io
  private _startReading(): void {
  if (this._reading) {
    return
  }
  this._reading = true
  this.pq.on('readable', this._read)
  this.pq.startReader()
}

  private _awaitResult(cb: Function): void {
  this._queryCallback = cb
  return this._startReading()
}

// wait for the writable socket to drain
  private _waitForDrain(pq: Libpq, cb: Function): void {
  const res = pq.flush()
  // res of 0 is success
  if (res === 0) {
    return cb()
  }

  // res of -1 is failure
  if (res === -1) {
    return cb(pq.errorMessage())
  }
  // you cannot read & write on a socket at the same time
  return pq.writable(() => {
    this._waitForDrain(pq, cb)
  })
}

// send an async query to libpq and wait for it to
// finish writing query text to the socket
  private _dispatchQuery(pq: Libpq, fn: () => boolean, cb: Function): void {
  this._stopReading()
  const success = pq.setNonBlocking(true)
  if (!success) {
    return cb(new Error('Unable to set non-blocking to true'))
  }
  const sent = fn()
  if (!sent) {
    return cb(
      new Error(
        pq.errorMessage() || 'Something went wrong dispatching the query',
      ),
    )
  }
  this._waitForDrain(pq, cb)
}

  private _onResult(result: any): void {
  if (this._resultCount === 0) {
    this._results = result
    this._rows = result.rows
  } else if (this._resultCount === 1) {
    this._results = [this._results, result]
    this._rows = [this._rows, result.rows]
  } else {
    this._results.push(result)
    this._rows.push(result.rows)
  }
  this._resultCount++
}

  private _onReadyForQuery(): void {
  // remove instance callback
  const cb = this._queryCallback
  this._queryCallback = undefined

  // remove instance query error
  const err = this._queryError
  this._queryError = undefined

  // remove instance rows
  const rows = this._rows
  this._rows = undefined

  // remove instance results
  const results = this._results
  this._results = undefined

  this._resultCount = 0

  if (cb) {
    cb(err, rows || [], results)
  }
}
}

function throwIfError(pq: Libpq): void {
  const err = pq.resultErrorMessage() || pq.errorMessage()
  if (err) {
    throw new Error(err)
  }
}

export default Client
