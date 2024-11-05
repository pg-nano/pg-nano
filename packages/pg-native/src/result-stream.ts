import type Libpq from '@pg-nano/libpq'
import type EventEmitter from 'node:events'
import { debugQuery } from './debug.js'
import { PgNativeError, PgResultError } from './error.js'
import { CommandResult, QueryType, type Field, type IQuery } from './query.js'

type FieldBuffer = [name: string, dataTypeID: number, index: number]
type PayloadBuffer = [error: Error | undefined, result: unknown]

// These exist to reduce the number of heap allocations.
const field: FieldBuffer = ['', 0, 0]
const payload: PayloadBuffer = [undefined, undefined]

/**
 * Call this before `pq.startRead()` to set up a result stream that will
 * automatically stop if the query is aborted.
 */
export async function* streamResults<TResult>(
  pq: Libpq,
  query: IQuery,
): AsyncGenerator<TResult, void, unknown> {
  pq.startRead()

  while (true) {
    await promisedEvent(pq, 'readable', query.ctrl.signal)
    query.ctrl.signal.throwIfAborted()

    // Attempt to buffer available data from the server.
    if (!pq.consumeInput()) {
      debugQuery(`query:${query.id} failed to consumeInput`)
      query.error = new PgNativeError(pq.getLastErrorMessage())
      return
    }

    // Process results unless the query is waiting for more data.
    while (!pq.isBusy()) {
      if (!pq.getResult()) {
        // Free the last result before ending the stream.
        return pq.clear()
      }

      // After an error, we flush results but don't yield them.
      if (!query.error) {
        const [error, result] = receiveResult(pq, query)

        if (error) {
          query.error = error
          payload[0] = undefined
        } else if (result !== undefined) {
          yield result as TResult
          payload[1] = undefined
        }
      }
    }

    // Free the last result before waiting for more data.
    pq.clear()
  }
}

function promisedEvent(
  emitter: EventEmitter,
  eventName: string,
  signal?: AbortSignal | null,
) {
  return new Promise<void>(resolve => {
    const onResolve = () => {
      emitter.removeListener(eventName, onResolve)
      signal?.removeEventListener('abort', onResolve)
      resolve()
    }
    emitter.addListener(eventName, onResolve)
    signal?.addEventListener('abort', onResolve)
  })
}

function receiveResult(pq: Libpq, query: IQuery): PayloadBuffer {
  const status = pq.resultStatus()

  if (status === 'PGRES_FATAL_ERROR') {
    return oof(
      new PgResultError(pq.resultErrorMessage()),
      pq.resultErrorFields(),
    )
  }

  const fieldCount = pq.nfields()

  if (status === 'PGRES_SINGLE_TUPLE') {
    if (query.type === QueryType.value) {
      if (fieldCount !== 1) {
        return oof(singleFieldError(fieldCount))
      }
      for (const _ of receiveFields(pq, query, fieldCount)) {
        return ok(parseFieldValue(pq, query, 0, field))
      }
      return payload // no-op
    }

    const row: Record<string, unknown> = {}
    for (const [fieldName] of receiveFields(pq, query, fieldCount)) {
      row[fieldName] = parseFieldValue(pq, query, 0, field)
    }
    return ok(row)
  }

  if (status === 'PGRES_TUPLES_OK') {
    if (query.singleRowMode && query.type !== QueryType.full) {
      return payload // no-op
    }
    if (query.type === QueryType.value && fieldCount !== 1) {
      return oof(singleFieldError(fieldCount))
    }

    const rows = new Array<any>(pq.ntuples())
    if (query.type !== QueryType.value) {
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        rows[rowIndex] = {}
      }
    }

    const fields =
      query.type === QueryType.full ? new Array<Field>(fieldCount) : null

    for (const [fieldName] of receiveFields(pq, query, fieldCount)) {
      if (fields) {
        fields[field[2]] = { name: fieldName, dataTypeID: field[1] }
      }
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        const value = parseFieldValue(pq, query, rowIndex, field)
        if (query.type === QueryType.value) {
          rows[rowIndex] = value
        } else {
          rows[rowIndex][fieldName] = value
        }
      }
    }

    if (query.type !== QueryType.full) {
      return ok(rows)
    }
    return ok(
      new CommandResult(
        pq.cmdStatus().match(/^\w+/)![0],
        Number.parseInt(pq.cmdTuples(), 10),
        fields as Field[],
        rows as Record<string, unknown>[],
      ),
    )
  }

  if (status === 'PGRES_COMMAND_OK') {
    if (query.type === QueryType.value) {
      return ok(null)
    }
    if (query.type === QueryType.row) {
      return ok([])
    }
    return ok(new CommandResult(pq.cmdStatus().match(/^\w+/)![0], 0, [], []))
  }

  return oof(new PgNativeError(`Unsupported result status: ${status}`))
}

function singleFieldError(fieldCount: number) {
  return new PgNativeError(`Expected a single field, but got ${fieldCount}`)
}

function* receiveFields(pq: Libpq, query: IQuery, count: number) {
  for (let index = 0; index < count; index++) {
    let name = pq.fname(index)
    if (query.mapFieldName) {
      name = query.mapFieldName(name)
    }
    field[0] = name
    field[1] = pq.ftype(index)
    field[2] = index
    yield field
  }
}

function parseFieldValue(
  pq: Libpq,
  query: IQuery,
  rowIndex: number,
  [fieldName, dataTypeID, fieldIndex]: FieldBuffer,
) {
  const text = pq.getvalue(rowIndex, fieldIndex)
  if (text.length === 0 && pq.getisnull(rowIndex, fieldIndex)) {
    return null
  }
  const value = query.parseText(text, dataTypeID)
  return query.mapFieldValue ? query.mapFieldValue(value, fieldName) : value
}

function ok(result: unknown): PayloadBuffer {
  payload[1] = result
  return payload
}

function oof(error: Error, properties?: object): PayloadBuffer {
  payload[0] = Object.assign(error, properties)
  return payload
}
