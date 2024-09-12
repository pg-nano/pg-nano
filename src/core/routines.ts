import { type Row, sql, type SQLToken } from 'pg-native'
import { isArray } from 'radashi'
import type { Client } from './client.js'
import { arrifyParams } from './params.js'
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
export function routineQueryAll<TArgs extends object, TRow extends Row>(
  name: string | string[],
  params?: (string | string[])[] | null,
): Routine<TArgs, Query<TRow[]>> {
  const id = isArray(name) ? sql.id(...name) : sql.id(name)
  const routine = params
    ? (client: Client, args: TArgs) =>
        client.queryAll(sqlRoutineCall(id, arrifyParams(args, params)))
    : (client: Client, ...args: any[]) =>
        client.queryAll(sqlRoutineCall(id, args))

  return routine as any
}

/**
 * Create a dedicated query function for a Postgres routine that returns a
 * result set where each row has a single column. The result set may be empty.
 */
export function routineQueryAllValues<TArgs extends object, TResult>(
  name: string | string[],
  params?: (string | string[])[] | null,
): Routine<TArgs, Query<TResult[]>> {
  const id = isArray(name) ? sql.id(...name) : sql.id(name)
  const routine = params
    ? (client: Client, args: TArgs) =>
        client.queryAllValues(sqlRoutineCall(id, arrifyParams(args, params)))
    : (client: Client, ...args: any[]) =>
        client.queryAllValues(sqlRoutineCall(id, args))

  return routine as any
}

/**
 * Create a dedicated query function for a Postgres routine that returns a
 * single row or nothing.
 */
export function routineQueryOne<TArgs extends object, TRow extends Row>(
  name: string | string[],
  params?: (string | string[])[] | null,
): Routine<TArgs, Promise<TRow | null>> {
  const id = isArray(name) ? sql.id(...name) : sql.id(name)
  const routine = params
    ? (client: Client, args: TArgs) =>
        client.queryOne(sqlRoutineCall(id, arrifyParams(args, params), 1))
    : (client: Client, ...args: any[]) =>
        client.queryOne(sqlRoutineCall(id, args, 1))

  return routine as any
}

/**
 * Create a dedicated query function for a Postgres routine that returns a
 * single value (i.e. one row with one column) or nothing.
 */
export function routineQueryOneValue<TArgs extends object, TResult>(
  name: string | string[],
  params?: (string | string[])[] | null,
): Routine<TArgs, Promise<TResult | null>> {
  const id = isArray(name) ? sql.id(...name) : sql.id(name)
  const routine = params
    ? (client: Client, args: TArgs) =>
        client.queryOneValue(sqlRoutineCall(id, arrifyParams(args, params), 1))
    : (client: Client, ...args: any[]) =>
        client.queryOneValue(sqlRoutineCall(id, args, 1))

  return routine as any
}
