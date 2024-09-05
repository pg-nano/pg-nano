export const sql = /* @__PURE__ */ (() => {
  function sql(strings: TemplateStringsArray, ...values: SQLTemplateValue[]) {
    return new SQLTemplate(strings, values)
  }

  /** A database identifier, escaped with double quotes. */
  sql.id = (...ids: string[]): SQLToken =>
    ids.length === 1
      ? { type: 'id', id: ids[0] }
      : sql.join(
          '.',
          ids.map(id => ({ type: 'id', id })),
        )

  /** A literal value, escaped with single quotes. */
  sql.val = (value: unknown): SQLToken => ({ type: 'val', value })

  /** Joins an array of SQLTemplateValues with a separator. */
  sql.join = (
    separator: SQLTokenJoinSeparator | SQLTemplateValue,
    list: SQLTemplateValue[],
  ): SQLToken => ({ type: 'join', list, separator })

  /** Raw SQL syntax, dynamically inserted into the template. */
  sql.unsafe = (str: string) => new SQLTemplate([str], [])

  return sql
})()

export type SQLTemplateValue =
  | SQLTemplate
  | SQLToken
  | readonly SQLTemplateValue[]
  | ''

export class SQLTemplate {
  constructor(
    readonly strings: readonly string[],
    readonly values: SQLTemplateValue[],
  ) {}
}

type SQLTokenType = 'id' | 'val' | 'join'
type SQLTokenJoinSeparator = ';' | ',' | '.' | ' '
type SQLTokenValue = {
  id: {
    id: string
  }
  val: {
    value: unknown
  }
  join: {
    list: SQLTemplateValue[]
    separator: SQLTokenJoinSeparator | SQLTemplateValue
  }
}

export type SQLToken = SQLTokenType extends infer Type
  ? Type extends SQLTokenType
    ? { type: Type } & SQLTokenValue[Type]
    : never
  : never
