import type { QualifiedName } from '@pg-nano/pg-parser'
import { sql } from 'pg-nano'
import { unquote } from './util/unquote'

export function parseIdentifier(sql: string, startOffset = 0): SQLIdentifier {
  let schema: string | undefined
  let name = ''

  let inQuotes = false
  let cursor = startOffset

  while (cursor < sql.length) {
    const char = sql[cursor]

    if (char === '"') {
      if (inQuotes && sql[cursor + 1] === '"') {
        // Escaped quote inside quoted identifier
        name += '"'
        cursor += 2
      } else {
        // Toggle quote state
        inQuotes = !inQuotes
        cursor++
      }
    } else if (!inQuotes && (char === '.' || /\s/.test(char))) {
      if (char === '.') {
        // Namespace separator
        if (schema) {
          schema += '.' + name
        } else {
          schema = name
        }
        name = ''
        cursor++
      } else {
        // End of identifier
        break
      }
    } else {
      name += char
      cursor++
    }
  }

  return new SQLIdentifier(name, schema, startOffset, cursor)
}

export class SQLIdentifier {
  constructor(
    public name: string,
    public schema: string | undefined = undefined,
    public start: number | undefined = undefined,
    public end: number | undefined = undefined,
  ) {}

  get nameVal() {
    return sql.val(unquote(this.name))
  }

  /**
   * Guaranteed to return a string literal, even if the schema is undefined (in
   * which case it returns 'public').
   */
  get schemaVal() {
    return this.schema ? sql.val(unquote(this.schema)) : sql.val('public')
  }

  /**
   * Returns the identifier as it was written in the source code.
   */
  toString() {
    return this.schema ? `${this.schema}.${this.name}` : this.name
  }

  /**
   * Returns a SQL token for the identifier (for use in a `sql` template).
   */
  toSQL() {
    return sql.unsafe(`${this.schema ? `${this.schema}.` : ''}${this.name}`)
  }

  /**
   * Return a fully qualified identifier in string form. If no schema was
   * specified at parse time, it's assumed to be "public" unless otherwise
   * specified.
   */
  toQualifiedName(defaultSchema?: string) {
    return `${this.schema ?? defaultSchema ?? 'public'}.${this.name}`
  }

  withSchema(schema: string) {
    return new SQLIdentifier(this.name, schema)
  }

  compare(other: SQLIdentifier) {
    const thisSchema = this.schema ? unquote(this.schema) : 'public'
    const otherSchema = other.schema ? unquote(other.schema) : 'public'

    return (
      thisSchema === otherSchema && unquote(this.name) === unquote(other.name)
    )
  }

  static fromQualifiedName(names: QualifiedName) {
    const [name, schema] = names.map(name => name.String.sval).reverse()
    return new SQLIdentifier(name, schema)
  }
}
