import type { JSON, Row } from 'pg-nano'

type NotNull<T> = Exclude<T, null | undefined>
type AllowNull<T> = T | (T extends null | undefined ? null : never)

type Comparison<TValue> =
  | { is: AllowNull<TValue> }
  | { not: AllowNull<TValue> }
  | { gt: NotNull<TValue> }
  | { gte: NotNull<TValue> }
  | { lt: NotNull<TValue> }
  | { lte: NotNull<TValue> }
  | { in: NotNull<TValue>[] }
  | { notIn: NotNull<TValue>[] }

type FieldCondition<TRow extends Row> = {
  [TField in keyof TRow]: Extract<TRow[TField], JSON>
}

type Condition<TRow extends Row> =
  | FieldCondition<TRow>
  | AnyCondition<TRow>
  | AllCondition<TRow>

type AnyCondition<TRow extends Row> = {
  OR: Condition<TRow> | Condition<TRow>[]
}

type AllCondition<TRow extends Row> = {
  AND: Condition<TRow> | Condition<TRow>[]
}

export type WhereParams<TRow extends Row> = {}

export type CountParams = {}

export type FindParams = {}

export type ListParams = {}
