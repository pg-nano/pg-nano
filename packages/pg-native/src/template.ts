import { type SQLTemplateValue, SQLToken } from './template/token.js'

/**
 * Create a SQL template. The client is responsible for serializing the template
 * to a SQL string and binding the parameters.
 */
export const sql = /* @__PURE__ */ (() => {
  function sql(strings: TemplateStringsArray, ...values: SQLTemplateValue[]) {
    return SQLToken.template(strings, values)
  }

  /** A database identifier, escaped with double quotes. */
  sql.id = SQLToken.id

  /** A literal value, escaped with single quotes. */
  sql.val = SQLToken.val

  /**
   * A value to be parameterized. If a `SQLTemplate` contains a `sql.param`
   * token, it must not contain multiple statements.
   */
  sql.param = SQLToken.param

  /** Joins an array of SQLTemplateValues with a separator. */
  sql.join = SQLToken.join

  /** Raw SQL syntax, dynamically inserted into the template. */
  sql.unsafe = SQLToken.unsafe

  return sql
})()
