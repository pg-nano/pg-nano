import { isObject } from 'radashi'
import { detectIndent } from './whitespace.js'

const kSQLTokenBrand = Symbol.for('pg-nano:SQLToken')

export type SQLTemplate = SQLToken.Type extends infer T
  ? T extends SQLToken.Type
    ? SQLToken<T>
    : never
  : never

export type SQLTemplateValue =
  | readonly SQLTemplateValue[]
  | SQLTemplate
  | ''
  | null
  | undefined

export class SQLToken<T extends SQLToken.Type = SQLToken.Type> {
  protected readonly [kSQLTokenBrand] = true
  /**
   * Prefer this method over `instanceof` for checking if a value is an
   * `SQLToken`.
   */
  static isToken(value: unknown): value is SQLToken {
    return isObject(value) && kSQLTokenBrand in value
  }

  args: SQLToken.Args<T>
  command?: string | undefined
  params?: (string | null)[] | undefined

  constructor(
    public type: T,
    ...args: SQLToken.Args<T>
  ) {
    this.args = args
    if (type === SQLToken.Type.Template) {
      this.command = undefined
      this.params = undefined
    }
  }

  static template(strings: readonly string[], values: SQLTemplateValue[]) {
    const indent = (values.length && detectIndent(strings[0])) || ''
    return new SQLToken(SQLToken.Type.Template, strings, values, indent)
  }

  /** A database identifier, escaped with double quotes. */
  static id(...ids: string[]) {
    return ids.length === 1
      ? new SQLToken(SQLToken.Type.Id, ids[0])
      : SQLToken.join(
          '.',
          ids.map(id => new SQLToken(SQLToken.Type.Id, id)),
        )
  }

  /** A literal value, escaped with single quotes. */
  static val(value: unknown) {
    return new SQLToken(SQLToken.Type.Literal, value, true)
  }

  /**
   * A value to be parameterized. If a `SQLTemplate` contains a `sql.param`
   * token, it must not contain multiple statements.
   */
  static param(value: unknown) {
    return new SQLToken(SQLToken.Type.Literal, value, false)
  }

  /** Joins an array of SQLTemplateValues with a separator. */
  static join(
    separator: SQLToken.JoinSeparator | SQLTemplateValue,
    list: SQLTemplateValue[],
  ) {
    return new SQLToken(SQLToken.Type.Join, list, separator)
  }

  /** Raw SQL syntax, dynamically inserted into the template. */
  static unsafe(str: string) {
    return new SQLToken(SQLToken.Type.Unsafe, str)
  }
}

export declare namespace SQLToken {
  // biome-ignore lint/suspicious/noConstEnum:
  export const enum Type {
    Id = 'i',
    Join = 'j',
    Literal = 'l',
    Template = 't',
    Unsafe = 'u',
  }

  export type JoinSeparator = ';' | ',' | '.' | ' ' | '\n' | ''

  export type Args<T extends Type> = Extract<
    | [Type.Id, [id: string]]
    | [Type.Literal, [value: unknown, inline: boolean]]
    | [
        Type.Join,
        [list: SQLTemplateValue[], separator: JoinSeparator | SQLTemplateValue],
      ]
    | [Type.Unsafe, [str: string]]
    | [
        Type.Template,
        [
          strings: readonly string[],
          values: SQLTemplateValue[],
          indent: string,
        ],
      ],
    [T, any]
  >[1]
}
