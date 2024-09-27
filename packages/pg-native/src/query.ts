import type Libpq from '@pg-nano/libpq'
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

export interface QueryOptions {
  /**
   * Map a field name before it's assigned to the result row.
   */
  mapFieldName?: (name: string) => string
  /**
   * Intercept a field value before it's assigned to the result row.
   *
   * The given field `name` has already been mapped by this point, if
   * `mapFieldName` is defined.
   */
  mapFieldValue?: (value: unknown, name: string) => unknown
  /**
   * Instruct libpq to use single-row mode for the result.
   *
   * @see https://www.postgresql.org/docs/current/libpq-single-row-mode.html#LIBPQ-PQSETSINGLEROWMODE
   */
  singleRowMode?: boolean
}

export interface IQuery extends QueryOptions {
  id: string
  type: QueryType
  command: SQLTemplate | QueryHook<any>
  parseText: (text: string, dataTypeID: number) => unknown
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
) => boolean | (() => Promise<TResult>)

export interface QueryPromise<TResult> extends Promise<TResult> {
  cancel: () => void
}