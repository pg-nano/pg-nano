import type { SQLTemplateValue } from '../template.js'

export type SQLToken = SQLToken.Type extends infer Type
  ? Type extends SQLToken.Type
    ? { type: Type } & SQLToken.Value[Type]
    : never
  : never

export declare namespace SQLToken {
  type Type = string & keyof Value

  type JoinSeparator = ';' | ',' | '.' | ' ' | '\n' | ''

  type Value = {
    id: {
      id: string
    }
    val: {
      value: unknown
      inline: boolean
    }
    join: {
      list: SQLTemplateValue[]
      separator: JoinSeparator | SQLTemplateValue
    }
  }
}
