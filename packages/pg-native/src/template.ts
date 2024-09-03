import { tokenizeValue } from './value'

export function sql(
  strings: TemplateStringsArray,
  ...values: SQLTemplateValue[]
) {
  return new SQLTemplate(strings, values)
}

/** A database identifier, escaped with double quotes. */
sql.id = (str: string) => new SQLToken('id', str)

/** A literal value, escaped with single quotes. */
sql.val = (value: unknown) => tokenizeValue<SQLToken>(value, tokenizer)

/** Raw SQL syntax, dynamically inserted into the template. */
sql.raw = (str: string) => new SQLToken('raw', str)

const tokenizer = {
  val: (value: string) => new SQLToken('val', value),
  raw: sql.raw,
}

export type SQLTemplateValue =
  | SQLTemplate
  | SQLToken
  | readonly SQLTemplateValue[]

export class SQLTemplate {
  constructor(
    readonly strings: TemplateStringsArray,
    readonly values: SQLTemplateValue[],
  ) {}
}

export class SQLToken {
  constructor(
    readonly type: 'id' | 'val' | 'raw',
    readonly value: string,
  ) {}
}
