import { isObject } from 'radashi'
import type { SQLToken } from './template/token.js'
import { detectIndent } from './template/whitespace.js'

const kSQLTemplateKind = Symbol.for('pg-nano:SQLTemplate')

export class SQLTemplate {
  command?: string = undefined
  params?: (string | null)[] | undefined = undefined
  readonly indent: string
  constructor(
    readonly strings: readonly string[],
    readonly values: SQLTemplateValue[],
  ) {
    this.indent = (values.length && detectIndent(strings[0])) || ''
  }
  protected readonly [kSQLTemplateKind] = true
  /**
   * Prefer this method over `instanceof` for checking if a value is an
   * `SQLTemplate`.
   */
  static isTemplate(value: unknown): value is SQLTemplate {
    return isObject(value) && kSQLTemplateKind in value
  }
}

export type SQLTemplateValue =
  | SQLTemplate
  | SQLToken
  | readonly SQLTemplateValue[]
  | ''
  | null
  | undefined

/**
 * Create a `SQLTemplate` object. The client is responsible for serializing the
 * template to a SQL string and binding the parameters.
 */
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
  sql.val = (value: unknown): SQLToken => ({ type: 'val', value, inline: true })

  /**
   * A value to be parameterized. If a `SQLTemplate` contains a `sql.param`
   * token, it must not contain multiple statements.
   */
  sql.param = (value: unknown): SQLToken => ({
    type: 'val',
    value,
    inline: false,
  })

  /** Joins an array of SQLTemplateValues with a separator. */
  sql.join = (
    separator: SQLToken.JoinSeparator | SQLTemplateValue,
    list: SQLTemplateValue[],
  ): SQLToken => ({ type: 'join', list, separator })

  /** Raw SQL syntax, dynamically inserted into the template. */
  sql.unsafe = (str: string) => new SQLTemplate([str], [])

  return sql
})()
