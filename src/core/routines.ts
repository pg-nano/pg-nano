import {
  sql,
  type Interval,
  type QueryOptions,
  type Range,
  type Row,
  type SQLToken,
} from 'pg-native'
import { isArray, isObject } from 'radashi'
import type { Client } from './client.js'
import { prepareInParams, type InParams } from './data/inParams.js'
import { prepareOutParam, type OutParams } from './data/outParams.js'
import type { Query } from './query.js'

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
): Routine<TArgs, Query<TRow | null>> {
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
): Routine<TArgs, Query<TResult, TResult>> {
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

  if (isObject(inParams)) {
    return (client: Client, namedValues?: unknown) => {
      return client[method as 'queryRow'](
        sqlRoutineCall(
          id,
          prepareInParams(client, namedValues, inParams),
          limit,
        ),
        outParams && getQueryOptions(client, outParams),
      )
    }
  }

  return (client: Client, ...values: any[]) => {
    return client[method as 'queryRow'](
      sqlRoutineCall(id, prepareInParams(client, values, inParams), limit),
      outParams && getQueryOptions(client, outParams),
    )
  }
}

function sqlRoutineCall(id: SQLToken, values: any[], limit: number) {
  return sql`
    SELECT * FROM ${id}(${sql.join(',', values.map(sql.val))})
    ${limit ? sql`LIMIT ${sql.unsafe(String(limit))}` : ''}
  `
}

const { hasOwnProperty } = Object.prototype

function getQueryOptions(client: Client, outParams: OutParams): QueryOptions {
  return {
    mapFieldValue(value, name) {
      if (hasOwnProperty.call(outParams, name)) {
        return prepareOutParam(client, value, outParams[name])
      }
      return value
    },
  }
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
