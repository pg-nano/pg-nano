import { Duplex, Writable } from 'node:stream'

class CopyStream extends Duplex {
  private pq: any
  private _reading: boolean

  constructor(pq: any, options?: any) {
    super(options)
    this.pq = pq
    this._reading = false
  }

  _write(
    chunk: any,
    encoding: string,
    cb: (error?: Error | null) => void,
  ): void {
    const result = this.pq.putCopyData(chunk)

    // sent successfully
    if (result === 1) {
      return cb()
    }

    // error
    if (result === -1) {
      return cb(new Error(this.pq.errorMessage()))
    }

    // command would block. wait for writable and call again.
    this.pq.writable(() => {
      this._write(chunk, encoding, cb)
    })
  }

  end(...args: any[]): void {
    const callback = args.pop()

    if (args.length) {
      this.write(args[0])
    }
    const result = this.pq.putCopyEnd()

    // sent successfully
    if (result === 1) {
      // consume our results and then call 'end' on the
      // "parent" writable class so we can emit 'finish' and
      // all that jazz
      return consumeResults(this.pq, (err: Error | null) => {
        Writable.prototype.end.call(this)

        // handle possible passing of callback to end method
        if (callback) {
          callback(err)
        }
      })
    }

    // error
    if (result === -1) {
      const err = new Error(this.pq.errorMessage())
      return this.emit('error', err)
    }

    // command would block. wait for writable and call end again
    // don't pass any buffers to end on the second call because
    // we already sent them to possible this.write the first time
    // we called end
    return this.pq.writable(() => this.end(callback))
  }

  private _consumeBuffer(
    cb: (error: Error | null, buffer: Buffer | null) => void,
  ): void {
    const result = this.pq.getCopyData(true)
    if (result instanceof Buffer) {
      return setImmediate(() => {
        cb(null, result)
      })
    }
    if (result === -1) {
      // end of stream
      return cb(null, null)
    }
    if (result === 0) {
      this.pq.once('readable', () => {
        this.pq.stopReader()
        this.pq.consumeInput()
        this._consumeBuffer(cb)
      })
      return this.pq.startReader()
    }
    cb(new Error('Unrecognized read status: ' + result), null)
  }

  _read(size: number): void {
    if (this._reading) {
      return
    }
    this._reading = true
    // console.log('read begin');
    this._consumeBuffer((err, buffer) => {
      this._reading = false
      if (err) {
        return this.emit('error', err)
      }
      if (buffer === false) {
        // nothing to read for now, return
        return
      }
      this.push(buffer)
    })
  }
}

const consumeResults = (pq: any, cb: (error: Error | null) => void): void => {
  const cleanup = () => {
    pq.removeListener('readable', onReadable)
    pq.stopReader()
  }

  const readError = (message?: string) => {
    cleanup()
    return cb(new Error(message || pq.errorMessage()))
  }

  const onReadable = () => {
    // read waiting data from the socket
    // e.g. clear the pending 'select'
    if (!pq.consumeInput()) {
      return readError()
    }

    // check if there is still outstanding data
    // if so, wait for it all to come in
    if (pq.isBusy()) {
      return
    }

    // load our result object
    pq.getResult()

    // "read until results return null"
    // or in our case ensure we only have one result
    if (pq.getResult() && pq.resultStatus() !== 'PGRES_COPY_OUT') {
      return readError('Only one result at a time is accepted')
    }

    if (pq.resultStatus() === 'PGRES_FATAL_ERROR') {
      return readError()
    }

    cleanup()
    return cb(null)
  }
  pq.on('readable', onReadable)
  pq.startReader()
}

export default CopyStream
