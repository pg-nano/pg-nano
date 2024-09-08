import { type Row, sql } from 'pg-native'
import type { Client } from './client.js'
import type { Query } from './query.js'
import { arrifyParams } from './util.js'

function sqlRoutineCall(schema: string, name: string, values: any[]) {
  return sql`${sql.id(schema)}.${sql.id(name)}(${values.map(sql.val)})`
}

/**
 * A function returned by `fnReturningMany`.
 */
export type FnReturningMany<
  TArgs extends object,
  TRow extends Row,
> = TArgs extends any[]
  ? (client: Client, ...args: TArgs) => Query<TRow[]>
  : (client: Client, args: TArgs) => Query<TRow[]>

/**
 * A function returned by `fnReturningOne`.
 */
export type FnReturningOne<
  TArgs extends object,
  TRow extends Row,
> = TArgs extends any[]
  ? (client: Client, ...args: TArgs) => Query<TRow | null>
  : (client: Client, args: TArgs) => Query<TRow | null>

/**
 * A function returned by `fnReturningAny`.
 */
export type FnReturningAny<TArgs extends object, TResult> = TArgs extends any[]
  ? (client: Client, ...args: TArgs) => Promise<TResult>
  : (client: Client, args: TArgs) => Promise<TResult>

/**
 * Create a TypeScript wrapper for a Postgres function that returns a result
 * set, which may be empty.
 */
export function fnReturningMany<TArgs extends object, TRow extends Row>(
  name: string,
  params?: string[] | null,
  schema = 'public',
): FnReturningMany<TArgs, TRow> {
  const routine = params
    ? (client: Client, args: TArgs) =>
        client.many(
          sql`SELECT * FROM ${sqlRoutineCall(schema, name, arrifyParams(args, params))}`,
        )
    : (client: Client, ...args: any[]) =>
        client.many(sql`SELECT * FROM ${sqlRoutineCall(schema, name, args)}`)

  return routine as any
}

/**
 * Create a TypeScript wrapper for a Postgres function that may return a single
 * row, or nothing.
 */
export function fnReturningOne<TArgs extends object, TRow extends Row>(
  name: string,
  params?: string[] | null,
  schema = 'public',
): FnReturningMany<TArgs, TRow> {
  const routine = params
    ? (client: Client, args: TArgs) =>
        client.one(
          sql`SELECT * FROM ${sqlRoutineCall(schema, name, arrifyParams(args, params))} LIMIT 1`,
        )
    : (client: Client, ...args: any[]) =>
        client.one(
          sql`SELECT * FROM ${sqlRoutineCall(schema, name, args)} LIMIT 1`,
        )

  return routine as any
}

/**
 * Create a TypeScript wrapper for a Postgres function that returns a single
 * value that can be of any type (whereas `many` and `one` are restricted to row
 * types).
 */
export function fnReturningAny<TArgs extends object, TResult>(
  name: string,
  params?: string[] | null,
  schema = 'public',
): FnReturningAny<TArgs, TResult> {
  const routine = params
    ? (client: Client, args: TArgs) =>
        client.scalar(
          sql`SELECT ${sqlRoutineCall(schema, name, arrifyParams(args, params))}`,
        )
    : (client: Client, ...args: any[]) =>
        client.scalar(sql`SELECT ${sqlRoutineCall(schema, name, args)}`)

  return routine as any
}
