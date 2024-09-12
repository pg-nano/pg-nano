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
  readonly indent: string
  constructor(
    readonly strings: readonly string[],
    readonly values: SQLTemplateValue[],
  ) {
    this.indent = (values.length && detectIndent(strings[0])) || ''
  }
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

// Find the indentation of the first non-empty line.
function detectIndent(text: string) {
  return text.match(/\n([ \t]+)(?:\S|$)/)?.[1]
}
