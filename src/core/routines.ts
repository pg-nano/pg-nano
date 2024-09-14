import {
  sql,
  type Interval,
  type Range,
  type Row,
  type SQLToken,
} from 'pg-native'
import { isArray, isObject } from 'radashi'
import type { Client } from './client.js'
import { parseCompositeFields } from './data/composite.js'
import { type OutParams, prepareParams, type InParams } from './data/params.js'
import type { Query, QueryOptions } from './query.js'

export type Routine<TArgs extends object, TResult> = TArgs extends any[]
  ? (client: Client, ...args: TArgs) => TResult
  : object extends TArgs
    ? (client: Client, args?: TArgs | UnwrapSingleKey<TArgs>) => TResult
    : (client: Client, args: TArgs | UnwrapSingleKey<TArgs>) => TResult

/**
 * Create a dedicated query function for a Postgres routine that returns a
 * result set of any number of rows. The result set may be empty.
 */
export function bindQueryRowList<TArgs extends object, TRow extends Row>(
  name: string | string[],
  inParams: InParams,
  outParams?: OutParams | null,
): Routine<TArgs, Query<TRow[]>> {
  return bindRoutine('queryRowList', name, inParams, outParams) as any
}

/**
 * Create a dedicated query function for a Postgres routine that returns a
 * result set where each row has a single column. The result set may be empty.
 */
export function bindQueryValueList<TArgs extends object, TResult>(
  name: string | string[],
  inParams: InParams,
  outParams?: OutParams | null,
): Routine<TArgs, Query<TResult[]>> {
  return bindRoutine('queryValueList', name, inParams, outParams) as any
}

/**
 * Create a dedicated query function for a Postgres routine that returns a
 * single row or nothing.
 */
export function bindQueryRow<TArgs extends object, TRow extends Row>(
  name: string | string[],
  inParams: InParams,
  outParams?: OutParams | null,
): Routine<TArgs, Promise<TRow | null>> {
  return bindRoutine('queryRow', name, inParams, outParams) as any
}

/**
 * Create a dedicated query function for a Postgres routine that returns a
 * single value (i.e. one row with one column).
 */
export function bindQueryValue<TArgs extends object, TResult>(
  name: string | string[],
  inParams: InParams,
  outParams?: OutParams | null,
): Routine<TArgs, Promise<TResult>> {
  return bindRoutine('queryValue', name, inParams, outParams) as any
}

function bindRoutine(
  method: 'queryRow' | 'queryRowList' | 'queryValue' | 'queryValueList',
  name: string | string[],
  inParams: InParams,
  outParams?: OutParams | null,
): Routine<any, any> {
  const id = isArray(name) ? sql.id(...name) : sql.id(name)
  const limit = method.endsWith('List') ? 0 : 1
  const options: QueryOptions | undefined = outParams
    ? { resultParser: result => parseCompositeFields(result, outParams) }
    : undefined

  return isObject(inParams)
    ? (client: Client, namedValues?: unknown) =>
        client[method as 'queryRow'](
          sqlRoutineCall(id, prepareParams(namedValues, inParams), limit),
          options,
        )
    : (client: Client, ...values: any[]) =>
        client[method as 'queryRow'](
          sqlRoutineCall(id, prepareParams(values, inParams), limit),
          options,
        )
}

function sqlRoutineCall(id: SQLToken, values: any[], limit: number) {
  return sql`
    SELECT * FROM ${id}(${sql.join(',', values.map(sql.val))})
    ${limit ? sql`LIMIT ${sql.unsafe(String(limit))}` : ''}
  `
}

/**
 * Allow a single value to be passed instead of named parameters, unless the
 * value is a plain object.
 */
type UnwrapSingleKey<T> = keyof T extends infer TKey
  ? TKey extends keyof T
    ? { [K in TKey]: T[K] } extends T
      ? T[TKey] extends
          | readonly any[]
          | Interval
          | Range<any>
          | Date
          | RegExp
          | NodeJS.TypedArray
          | Buffer
        ? T[TKey]
        : Exclude<T[TKey], object>
      : never
    : never
  : never
