import { type Row, sql, type SQLToken } from 'pg-native'
import { isArray } from 'radashi'
import type { Client } from './client.js'
import { arrifyParams, type ParamDef } from './params.js'
import type { Query } from './query.js'

function sqlRoutineCall(id: SQLToken, values: any[], limit?: number) {
  return sql`
    SELECT * FROM ${id}(${values.map(sql.val)})
    ${limit ? sql`LIMIT ${sql.unsafe(String(limit))}` : ''}
  `
}

export type Routine<TArgs extends object, TResult> = TArgs extends any[]
  ? (client: Client, ...args: TArgs) => TResult
  : (client: Client, args: TArgs) => TResult

/**
 * Create a dedicated query function for a Postgres routine that returns a
 * result set of any number of rows. The result set may be empty.
 */
export function bindQueryRowList<TArgs extends object, TRow extends Row>(
  name: string | string[],
  paramDefs?: ParamDef[] | null,
): Routine<TArgs, Query<TRow[]>> {
  const id = isArray(name) ? sql.id(...name) : sql.id(name)
  const routine = paramDefs
    ? (client: Client, params: Record<string, unknown>) =>
        client.queryRowList(sqlRoutineCall(id, arrifyParams(params, paramDefs)))
    : (client: Client, ...args: any[]) =>
        client.queryRowList(sqlRoutineCall(id, args))

  return routine as any
}

/**
 * Create a dedicated query function for a Postgres routine that returns a
 * result set where each row has a single column. The result set may be empty.
 */
export function bindQueryValueList<TArgs extends object, TResult>(
  name: string | string[],
  paramDefs?: ParamDef[] | null,
): Routine<TArgs, Query<TResult[]>> {
  const id = isArray(name) ? sql.id(...name) : sql.id(name)
  const routine = paramDefs
    ? (client: Client, params: Record<string, unknown>) =>
        client.queryValueList(
          sqlRoutineCall(id, arrifyParams(params, paramDefs)),
        )
    : (client: Client, ...args: any[]) =>
        client.queryValueList(sqlRoutineCall(id, args))

  return routine as any
}

/**
 * Create a dedicated query function for a Postgres routine that returns a
 * single row or nothing.
 */
export function bindQueryRow<TArgs extends object, TRow extends Row>(
  name: string | string[],
  paramDefs?: ParamDef[] | null,
  returnDefs?: ParamDef[] | null,
): Routine<TArgs, Promise<TRow | null>> {
  const id = isArray(name) ? sql.id(...name) : sql.id(name)
  const routine = paramDefs
    ? (client: Client, params: Record<string, unknown>) =>
        client.queryRow(sqlRoutineCall(id, arrifyParams(params, paramDefs), 1))
    : (client: Client, ...args: any[]) =>
        client.queryRow(sqlRoutineCall(id, args, 1))

  return routine as any
}

/**
 * Create a dedicated query function for a Postgres routine that returns a
 * single value (i.e. one row with one column) or nothing.
 */
export function bindQueryValue<TArgs extends object, TResult>(
  name: string | string[],
  paramDefs?: ParamDef[] | null,
): Routine<TArgs, Promise<TResult | null>> {
  const id = isArray(name) ? sql.id(...name) : sql.id(name)
  const routine = paramDefs
    ? (client: Client, params: Record<string, unknown>) =>
        client.queryValue(
          sqlRoutineCall(id, arrifyParams(params, paramDefs), 1),
        )
    : (client: Client, ...args: any[]) =>
        client.queryValue(sqlRoutineCall(id, args, 1))

  return routine as any
}
