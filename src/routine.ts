import { type Row, sql } from 'pg-native'
import type { Client } from './client.js'
import type { Query } from './query.js'
import { arrifyParams } from './util.js'

function sqlRoutineCall(schema: string, name: string, values: any[]) {
  return sql`${sql.id(schema)}.${sql.id(name)}(${values.map(sql.val)})`
}

export type Routine<
  TArgs extends object,
  TRow extends Row,
> = TArgs extends any[]
  ? (client: Client, ...args: TArgs) => Query<TRow[]>
  : (client: Client, args: TArgs) => Query<TRow[]>

export type ScalarRoutine<TArgs extends object, TResult> = TArgs extends any[]
  ? (client: Client, ...args: TArgs) => Promise<TResult>
  : (client: Client, args: TArgs) => Promise<TResult>

export function declareRoutine<TArgs extends object, TRow extends Row>(
  name: string,
  params?: string[] | null,
  schema = 'public',
): Routine<TArgs, TRow> {
  const routine = params
    ? (client: Client, args: TArgs) =>
        client.many(
          sql`SELECT * FROM ${sqlRoutineCall(schema, name, arrifyParams(args, params))}`,
        )
    : (client: Client, ...args: any[]) =>
        client.many(sql`SELECT * FROM ${sqlRoutineCall(schema, name, args)}`)

  return routine as any
}

export function declareScalarRoutine<TArgs extends object, TResult>(
  name: string,
  params?: string[] | null,
  schema = 'public',
): ScalarRoutine<TArgs, TResult> {
  const routine = params
    ? (client: Client, args: TArgs) =>
        client.scalar(
          sql`SELECT ${sqlRoutineCall(schema, name, arrifyParams(args, params))}`,
        )
    : (client: Client, ...args: any[]) =>
        client.scalar(sql`SELECT ${sqlRoutineCall(schema, name, args)}`)

  return routine as any
}
