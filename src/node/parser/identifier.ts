import type { QualifiedName } from '@pg-nano/pg-parser'
import { sql, type SQLTemplateValue } from 'pg-native'
import { unique } from 'radashi'

export class SQLIdentifier {
  static fromQualifiedName(
    names: QualifiedName,
    includesField?: boolean,
  ): SQLIdentifier {
    return Object.assign(
      new SQLIdentifier(''),
      parseQualifiedName(names, includesField),
    )
  }

  constructor(
    public name: string,
    public schema: string | undefined = undefined,
    public start?: number | undefined,
    public end?: number | undefined,
  ) {}

  /** Optional field name being referenced */
  public field?: string | undefined

  /**
   * Returns a literal string containing the identifier name (not including the
   * schema). This will be safely escaped by libpq.
   */
  get nameVal() {
    return sql.val(this.name)
  }

  /**
   * Returns a literal string containing the schema name (which defaults to
   * "public" if undefined). This will be safely escaped by libpq.
   */
  get schemaVal() {
    return sql.val(this.schema ?? 'public')
  }

  /**
   * Returns a SQL token for the identifier (for use in a `sql` template). This
   * will be safely escaped by libpq.
   */
  toSQL(defaultSchema?: string): SQLTemplateValue {
    const schema = this.schema ?? defaultSchema ?? 'public'
    if (this.name) {
      return schema === 'pg_catalog'
        ? sql.unsafe(this.name)
        : sql.id(schema, this.name)
    }
    return sql.id(schema)
  }

  /**
   * Return a fully qualified identifier in string form. If no schema was
   * specified at parse time, it's assumed to be "public" unless otherwise
   * specified.
   */
  toQualifiedName(defaultSchema?: string) {
    const schema = this.schema ?? defaultSchema ?? 'public'

    return (
      (schema ? unsafelyQuotedName(schema) : '') +
      (this.name ? (schema ? '.' : '') + unsafelyQuotedName(this.name) : '') +
      (this.field ? '.' + unsafelyQuotedName(this.field) : '')
    )
  }

  /**
   * Reteurns a RegExp that matches this identifier. The first capture group is
   * the schema name (which may be undefined), and the second capture group is
   * the identifier name.
   */
  toRegExp(flags?: string) {
    let pattern = ''

    const schema = this.schema ?? 'public'
    const quotedSchema = quoteName(schema)
    pattern += `(?:(${schema}|${quotedSchema})\\.)?`

    const quotedName = quoteName(this.name)
    pattern += `(${this.name}|${quotedName})`

    return new RegExp(pattern, flags)
  }

  /**
   * Copy this identifier with a new schema.
   */
  withSchema(schema: string): this {
    const id = Object.create(this) as this
    id.schema = schema
    return id
  }

  /**
   * Copy this identifier with a new field name.
   */
  withField(field: string): this {
    const id = Object.create(this) as this
    id.field = field
    return id
  }

  /**
   * Check if this identifier is equal to another.
   */
  equals(other: SQLIdentifier) {
    return (
      this.name === other.name &&
      (this.schema ?? 'public') === (other.schema ?? 'public') &&
      this.field === other.field
    )
  }
}

export interface SQLIdentifier {
  /** @deprecated */
  toString(): never
}

export function toUniqueIdList(ids: SQLIdentifier[], defaultSchema?: string) {
  return unique(ids, id => id.toQualifiedName(defaultSchema))
}

const defaultUnquotedChars = 'abcdefghijklmnopqrstuvwxyz0123456789_'

export function quoteName(name: string) {
  let quotedName = ''
  for (const char of name) {
    quotedName += char === '"' ? '""' : char
  }
  return `"${quotedName}"`
}

/** ⚠️ UNSAFE, do not use with untrusted input, as `\"` sequences are not handled */
export function unsafelyQuotedName(name: string, moreUnquotedChars = '') {
  const unquotedChars = defaultUnquotedChars + moreUnquotedChars
  let needsQuotes = false
  let quotedName = ''
  for (const char of name) {
    needsQuotes ||= !unquotedChars.includes(char)
    quotedName += char === '"' ? '""' : char
  }
  return needsQuotes ? `"${quotedName}"` : quotedName
}

export function parseQualifiedName(
  names: QualifiedName,
  includesField?: boolean,
) {
  let schema: string | undefined
  let field: string | undefined

  let index = names.length
  if (includesField) {
    field = names[--index].String.sval
  }
  const name = names[--index].String.sval
  if (index > 0) {
    schema = names[--index].String.sval
  }

  return { schema, name, field }
}
