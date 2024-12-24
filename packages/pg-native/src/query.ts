import type Libpq from '@pg-nano/libpq'
import type { Options } from 'option-types'
import type { SQLTemplate } from './template.js'

export enum QueryType {
  /**
   * The query expects a `CommandResult` from the server.
   */
  full = 1,
  /**
   * The query expects a row with any number of columns.
   */
  row = 2,
  /**
   * The query expects an arbitrary value, extracted from the first column of
   * the first row.
   */
  value = 3,
  /**
   * The query does not expect a result from the server.
   */
  void = 4,
}

export type QueryOptions = Options<{
  /**
   * Map a field name before it's assigned to the result row.
   *
   * This callback is also applied to composite fields.
   */
  mapFieldName?: (name: string) => string
  /**
   * Intercept a field value before it's assigned to the result row.
   *
   * The given field `name` has already been mapped by this point, if
   * `mapFieldName` is defined.
   *
   * Note: This callback is only applied to root-level fields (i.e. composite
   * fields are not mapped).
   */
  mapFieldValue?: (value: unknown, name: string) => unknown
  /**
   * Instruct libpq to use single-row mode for the result.
   *
   * @see https://www.postgresql.org/docs/current/libpq-single-row-mode.html#LIBPQ-PQSETSINGLEROWMODE
   */
  singleRowMode?: boolean
}>

export interface QueryDescriptor extends QueryOptions {
  id: string
  type: QueryType
  input: SQLTemplate | QueryHook<any>
  parseText: (
    text: string,
    dataTypeID: number,
    mapFieldName: ((name: string) => string) | undefined,
  ) => unknown
  ctrl: AbortController
  error: Error | null
}

export type Field = { name: string; dataTypeID: number }
export type Row = Record<string, unknown>

export class CommandResult<TRow extends Row = Row> {
  constructor(
    readonly command: string,
    readonly rowCount: number,
    readonly fields: Field[],
    readonly rows: TRow[],
  ) {}
}

/**
 * Hook into the query execution process. Useful for `libpq` tasks beyond
 * executing a dynamic query.
 *
 * If the function returns a promise, the query execution will wait for the
 * promise to resolve before continuing.
 */
export type QueryHook<TResult> = (
  pq: Libpq,
  query: QueryDescriptor,
) => boolean | (() => TResult | Promise<TResult>)

export interface QueryPromise<TResult> extends Promise<TResult> {
  cancel: () => void
}
