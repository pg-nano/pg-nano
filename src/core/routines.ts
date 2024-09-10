import { type Row, sql } from 'pg-native'
import type { Client } from './client.js'
import type { Query } from './query.js'
import { arrifyParams } from './util.js'

function sqlRoutineCall(schema: string, name: string, values: any[]) {
  return sql`${sql.id(schema)}.${sql.id(name)}(${values.map(sql.val)})`
}

export type Routine<TArgs extends object, TResult> = TArgs extends any[]
  ? (client: Client, ...args: TArgs) => TResult
  : (client: Client, args: TArgs) => TResult

/**
 * Create a dedicated query function for a Postgres routine that returns a
 * result set of any number of rows. The result set may be empty.
 */
export function routineQueryAll<TArgs extends object, TRow extends Row>(
  name: string,
  params?: string[] | null,
  schema = 'public',
): Routine<TArgs, Query<TRow[]>> {
  const routine = params
    ? (client: Client, args: TArgs) =>
        client.queryAll(
          sql`SELECT * FROM ${sqlRoutineCall(schema, name, arrifyParams(args, params))}`,
        )
    : (client: Client, ...args: any[]) =>
        client.queryAll(
          sql`SELECT * FROM ${sqlRoutineCall(schema, name, args)}`,
        )

  return routine as any
}

/**
 * Create a dedicated query function for a Postgres routine that returns a
 * result set where each row has a single column. The result set may be empty.
 */
export function routineQueryAllValues<TArgs extends object, TResult>(
  name: string,
  params?: string[] | null,
  schema = 'public',
): Routine<TArgs, Query<TResult[]>> {
  const routine = params
    ? (client: Client, args: TArgs) =>
        client.queryAllValues(
          sql`SELECT * FROM ${sqlRoutineCall(schema, name, arrifyParams(args, params))}`,
        )
    : (client: Client, ...args: any[]) =>
        client.queryAllValues(
          sql`SELECT * FROM ${sqlRoutineCall(schema, name, args)}`,
        )

  return routine as any
}

/**
 * Create a dedicated query function for a Postgres routine that returns a
 * single row or nothing.
 */
export function routineQueryOne<TArgs extends object, TRow extends Row>(
  name: string,
  params?: string[] | null,
  schema = 'public',
): Routine<TArgs, Promise<TRow | null>> {
  const routine = params
    ? (client: Client, args: TArgs) =>
        client.queryOne(
          sql`SELECT * FROM ${sqlRoutineCall(schema, name, arrifyParams(args, params))} LIMIT 1`,
        )
    : (client: Client, ...args: any[]) =>
        client.queryOne(
          sql`SELECT * FROM ${sqlRoutineCall(schema, name, args)} LIMIT 1`,
        )

  return routine as any
}

/**
 * Create a dedicated query function for a Postgres routine that returns a
 * single value (i.e. one row with one column) or nothing.
 */
export function routineQueryOneValue<TArgs extends object, TResult>(
  name: string,
  params?: string[] | null,
  schema = 'public',
): Routine<TArgs, Promise<TResult | null>> {
  const routine = params
    ? (client: Client, args: TArgs) =>
        client.queryOneValue(
          sql`SELECT * FROM ${sqlRoutineCall(schema, name, arrifyParams(args, params))} LIMIT 1`,
        )
    : (client: Client, ...args: any[]) =>
        client.queryOneValue(
          sql`SELECT * FROM ${sqlRoutineCall(schema, name, args)} LIMIT 1`,
        )

  return routine as any
}
