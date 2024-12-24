import type Libpq from '@pg-nano/libpq'
import { PgNativeError, PgResultError } from './error.js'
import {
  CommandResult,
  QueryType,
  type Field,
  type QueryDescriptor,
} from './query.js'

type FieldBuffer = [name: string, dataTypeID: number, index: number]
type PayloadBuffer = [error: Error | undefined, result: unknown]

// These exist to reduce the number of heap allocations.
const field: FieldBuffer = ['', 0, 0]
const payload: PayloadBuffer = [undefined, undefined]

// When the payload is accessed, its value is cleared.
const selfClearingPayload = Object.create(payload) as PayloadBuffer
for (const key of [0, 1]) {
  Object.defineProperty(selfClearingPayload, key, {
    get() {
      const value = payload[key]
      payload[key] = undefined
      return value
    },
  })
}

function resolve(result: unknown): PayloadBuffer {
  payload[1] = result
  return selfClearingPayload
}

function reject(error: Error, properties?: object): PayloadBuffer {
  payload[0] = Object.assign(error, properties)
  return selfClearingPayload
}

export function getResult(pq: Libpq, query: QueryDescriptor): PayloadBuffer {
  const status = pq.resultStatus()

  if (status === 'PGRES_FATAL_ERROR') {
    return reject(
      new PgResultError(pq.resultErrorMessage()),
      pq.resultErrorFields(),
    )
  }

  const fieldCount = pq.nfields()

  if (status === 'PGRES_SINGLE_TUPLE') {
    if (query.type === QueryType.value) {
      if (fieldCount !== 1) {
        return reject(singleFieldError(fieldCount))
      }
      for (const _ of getResultFields(pq, query, fieldCount)) {
        return resolve(parseFieldValue(pq, query, 0, field))
      }
      return payload // no-op
    }

    const row: Record<string, unknown> = {}
    for (const [fieldName] of getResultFields(pq, query, fieldCount)) {
      row[fieldName] = parseFieldValue(pq, query, 0, field)
    }
    return resolve(row)
  }

  if (status === 'PGRES_TUPLES_OK') {
    if (query.singleRowMode && query.type !== QueryType.full) {
      return payload // no-op
    }
    if (query.type === QueryType.value && fieldCount !== 1) {
      return reject(singleFieldError(fieldCount))
    }

    const rows = new Array<any>(pq.ntuples())
    if (query.type !== QueryType.value) {
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        rows[rowIndex] = {}
      }
    }

    const fields =
      query.type === QueryType.full ? new Array<Field>(fieldCount) : null

    for (const [fieldName] of getResultFields(pq, query, fieldCount)) {
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
      return resolve(rows)
    }
    return resolve(
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
      return resolve(null)
    }
    if (query.type === QueryType.row) {
      return resolve([])
    }
    const fields = new Array<Field>(fieldCount)
    for (const [fieldName] of getResultFields(pq, query, fieldCount)) {
      fields[field[2]] = { name: fieldName, dataTypeID: field[1] }
    }
    return resolve(
      new CommandResult(pq.cmdStatus().match(/^\w+/)?.[0] ?? '', 0, fields, []),
    )
  }

  return reject(new PgNativeError(`Unsupported result status: ${status}`))
}

function* getResultFields(pq: Libpq, query: QueryDescriptor, count: number) {
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
  query: QueryDescriptor,
  rowIndex: number,
  [fieldName, dataTypeID, fieldIndex]: FieldBuffer,
) {
  const text = pq.getvalue(rowIndex, fieldIndex)
  if (text.length === 0 && pq.getisnull(rowIndex, fieldIndex)) {
    return null
  }
  const value = query.parseText(text, dataTypeID, query.mapFieldName)
  return query.mapFieldValue ? query.mapFieldValue(value, fieldName) : value
}

function singleFieldError(fieldCount: number) {
  return new PgNativeError(`Expected a single field, but got ${fieldCount}`)
}
