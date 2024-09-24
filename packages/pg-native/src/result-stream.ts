import type Libpq from '@pg-nano/libpq'
import type EventEmitter from 'node:events'
import { debugQuery } from './debug.js'
import { PgNativeError, PgResultError } from './error.js'
import { CommandResult, QueryType, type Field, type IQuery } from './query.js'

type FieldDescription = [name: string, dataTypeID: number, index: number]

const field: FieldDescription = ['', 0, 0]

/**
 * Set by `receiveResult` when an error occurs. Errors must not be thrown, so
 * the current query can have its output fully processed.
 */
let error: Error | null = null

/**
 * Call this before `pq.startRead()` to set up a result stream that will
 * automatically stop if the query is aborted.
 */
export async function* streamResults<TResult>(
  pq: Libpq,
  query: IQuery,
): AsyncGenerator<TResult, void, unknown> {
  pq.startRead()

  read: while (true) {
    await promisedEvent(pq, 'readable', query.ctrl.signal)
    query.ctrl.signal.throwIfAborted()

    // Attempt to buffer available data from the server.
    if (!pq.consumeInput()) {
      debugQuery(`query:${query.id} failed to consumeInput`)
      throw new PgNativeError(pq.getLastErrorMessage())
    }

    // Process results unless the query is waiting for more data.
    while (!pq.isBusy()) {
      if (!pq.getResult()) {
        break read // Query completed.
      }
      if (!error) {
        const result = receiveResult(pq, query, field) as TResult

        if (error) {
          query.error = error
        } else {
          yield result
        }
      }
    }

    // Free the last processed result, if any.
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

function receiveResult(pq: Libpq, query: IQuery, field: FieldDescription) {
  const status = pq.resultStatus()

  if (status === 'PGRES_FATAL_ERROR') {
    error = new PgResultError(pq.resultErrorMessage())
    Object.assign(error, pq.resultErrorFields())
    return
  }

  const fieldCount = pq.nfields()

  if (status === 'PGRES_SINGLE_TUPLE') {
    if (query.type === QueryType.value) {
      if (!assertSingleField(fieldCount)) {
        return
      }
      for (const _ of receiveFields(pq, query, field, fieldCount)) {
        return parseFieldValue(pq, query, 0, field)
      }
      return null
    }

    const row: Record<string, unknown> = {}
    for (const [fieldName] of receiveFields(pq, query, field, fieldCount)) {
      row[fieldName] = parseFieldValue(pq, query, 0, field)
    }
    return row
  }

  if (status === 'PGRES_TUPLES_OK') {
    if (query.type === QueryType.value && !assertSingleField(fieldCount)) {
      return
    }

    const rows = new Array<any>(pq.ntuples())
    if (query.type !== QueryType.value) {
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        rows[rowIndex] = {}
      }
    }

    const fields =
      query.type === QueryType.full ? new Array<Field>(fieldCount) : null

    for (const [fieldName] of receiveFields(pq, query, field, fieldCount)) {
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
      return rows
    }
    return new CommandResult(
      pq.cmdStatus(),
      Number.parseInt(pq.cmdTuples(), 10),
      fields as Field[],
      rows as Record<string, unknown>[],
    )
  }

  if (status === 'PGRES_COMMAND_OK') {
    if (query.type === QueryType.value) {
      return null
    }
    if (query.type === QueryType.row) {
      return []
    }
    return new CommandResult(pq.cmdStatus(), 0, [], [])
  }

  error = new PgNativeError(`Unsupported result status: ${status}`)
}

function assertSingleField(fieldCount: number) {
  if (fieldCount === 1) {
    return true
  }
  error = new PgNativeError(`Expected a single field, but got ${fieldCount}`)
  return false
}

function* receiveFields(
  pq: Libpq,
  query: IQuery,
  field: FieldDescription,
  count: number,
) {
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
  [fieldName, dataTypeID, fieldIndex]: FieldDescription,
) {
  const text = pq.getvalue(rowIndex, fieldIndex)
  if (text.length === 0 && pq.getisnull(rowIndex, fieldIndex)) {
    return null
  }
  const value = query.parseText(text, dataTypeID)
  return query.mapFieldValue ? query.mapFieldValue(value, fieldName) : value
}
