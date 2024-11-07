import { select, type QualifiedName, type TypeName } from '@pg-nano/pg-parser'
import { sql, type SQLTemplateValue } from 'pg-native'
import { unique } from 'radashi'

export class SQLIdentifier {
  constructor(
    public name: string,
    public schema: string | undefined = undefined,
    public start?: number | undefined,
    public end?: number | undefined,
  ) {}

  /** Optional field name being referenced */
  public field?: string

  /**
   * Exists if referencing an array type. One element indicates a 1-dimensional
   * array, two elements indicates a 2-dimensional array, etc. If a dimension is
   * `-1` or `null`, then the array is unbounded in that dimension. Otherwise,
   * the value is the upper bound of the array in that dimension.
   */
  public arrayBounds?: (number | null)[]

  /**
   * Exists if referencing a type with type modifiers.
   *
   * @example varchar(10) => [10]
   */
  public typeModifiers?: number[]

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
    const id =
      schema === 'pg_catalog'
        ? sql.unsafe(this.name)
        : sql.id(schema, this.name)

    const typeModifiers = this.typeModifiers
      ? sql.unsafe(`(${this.typeModifiers.join(', ')})`)
      : ''

    const arrayBounds = this.arrayBounds
      ? sql.unsafe(
          this.arrayBounds
            .map(bound => `[${bound === -1 ? '' : bound ?? ''}]`)
            .join(''),
        )
      : ''

    if (typeModifiers || arrayBounds) {
      return [id, typeModifiers, arrayBounds]
    }
    return id
  }

  /**
   * Return a fully qualified identifier in string form. If no schema was
   * specified at parse time, it's assumed to be "public" unless otherwise
   * specified.
   */
  toQualifiedName(defaultSchema?: string) {
    return (
      unsafelyQuotedName(this.schema ?? defaultSchema ?? 'public') +
      '.' +
      unsafelyQuotedName(this.name)
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
  withSchema(schema: string) {
    return new SQLIdentifier(this.name, schema)
  }

  /**
   * Check if this identifier is equal to another.
   */
  equals(other: SQLIdentifier) {
    return (
      this.name === other.name &&
      (this.schema ?? 'public') === (other.schema ?? 'public')
    )
  }

  static fromQualifiedName(names: QualifiedName, includesField?: boolean) {
    const id = new SQLIdentifier('')
    let index = names.length
    if (includesField) {
      id.field = names[--index].String.sval
    }
    id.name = names[--index].String.sval
    if (index > 0) {
      id.schema = names[--index].String.sval
    }
    return id
  }

  static fromTypeName(typeName: TypeName) {
    const id = SQLIdentifier.fromQualifiedName(
      typeName.names,
      typeName.pct_type,
    )
    if (typeName.typmods) {
      id.typeModifiers = typeName.typmods.map(typmod => {
        const ival = select(typmod, 'ival.ival')
        if (ival === undefined) {
          throw new Error('expected ival')
        }
        return ival
      })
    }
    if (typeName.arrayBounds) {
      id.arrayBounds = typeName.arrayBounds.map(
        bound => bound.Integer.ival ?? null,
      )
    }
    return id
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
