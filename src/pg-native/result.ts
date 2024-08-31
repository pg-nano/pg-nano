import type Libpq from 'libpq'
import * as types from 'pg-types'

export class Result<TRow extends Row = Row> {
  constructor(
    readonly command: string,
    readonly rowCount: number,
    readonly fields: Field[],
    readonly rows: TRow[],
  ) {}
}

export type Row = Record<string, unknown>

export interface Field {
  name: string
  dataTypeID: number
}

export function buildResult(pq: Libpq) {
  const command = consumeCommand(pq)
  const rowCount = consumeRowCount(pq)
  const fields = consumeFields(pq)
  const rows = consumeRows(pq, fields)

  return new Result(command, rowCount, fields, rows)
}

function consumeCommand(pq: Libpq) {
  return pq.cmdStatus().split(' ')[0]
}

function consumeRowCount(pq: Libpq) {
  return Number.parseInt(pq.cmdTuples(), 10)
}

function consumeFields(pq: Libpq) {
  const fields = new Array(pq.nfields())
  for (let i = 0; i < fields.length; i++) {
    fields[i] = {
      name: pq.fname(i),
      dataTypeID: pq.ftype(i),
    }
  }
  return fields
}

function consumeRows(pq: Libpq, fields: Field[]) {
  const rows = new Array(pq.ntuples())
  for (let i = 0; i < rows.length; i++) {
    rows[i] = consumeRowAsObject(pq, i, fields)
  }
  return rows
}

function consumeRowAsObject(pq: Libpq, rowIndex: number, fields: Field[]) {
  const row: Record<string, unknown> = {}
  for (let colIndex = 0; colIndex < fields.length; colIndex++) {
    row[fields[colIndex].name] = readValue(pq, rowIndex, colIndex, fields)
  }
  return row
}

function readValue(
  pq: Libpq,
  rowIndex: number,
  colIndex: number,
  fields: Field[],
) {
  const rawValue = pq.getvalue(rowIndex, colIndex)
  if (rawValue === '' && pq.getisnull(rowIndex, colIndex)) {
    return null
  }
  const parseValue = types.getTypeParser(fields[colIndex].dataTypeID)
  return parseValue(rawValue)
}
