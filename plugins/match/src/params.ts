import type { JSON, Row } from 'pg-nano'

type NotNull<T> = Exclude<T, null | undefined>
type AllowNull<T> = T extends null | undefined ? null : T

type Comparison<TValue> =
  | { equals: AllowNull<TValue> }
  | { not: AllowNull<TValue> }
  | { gt: NotNull<TValue> }
  | { gte: NotNull<TValue> }
  | { lt: NotNull<TValue> }
  | { lte: NotNull<TValue> }
  | { in: NotNull<TValue>[] }
  | { notIn: NotNull<TValue>[] }

type FieldPattern<TRow extends Row> = {
  [TField in keyof TRow]:
    | Extract<TRow[TField], JSON>
    | Comparison<Extract<TRow[TField], JSON>>
}

type LogicalExpression<TRow extends Row> =
  | { OR: FilterCondition<TRow> | FilterCondition<TRow>[] }
  | { AND: FilterCondition<TRow> | FilterCondition<TRow>[] }

type FilterCondition<TRow extends Row> =
  | FieldPattern<TRow>
  | LogicalExpression<TRow>

export type CountParams<TRow extends Row> = {}

export type FindParams<TRow extends Row> = {}

export type ListParams<TRow extends Row> = {}
