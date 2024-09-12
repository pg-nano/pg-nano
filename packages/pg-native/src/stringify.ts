import type Libpq from '@pg-nano/libpq'
import { isArray, isString } from 'radashi'
import { SQLTemplate, type SQLTemplateValue } from './template'
import { escapeValue } from './value.js'

export function stringifyTemplate(
  template: SQLTemplate,
  pq: Libpq,
  options?: { reindent?: boolean },
  parentIndent?: string,
): string {
  let sql = ''

  for (let i = 0; i < template.strings.length; i++) {
    sql += template.strings[i]

    if (i < template.values.length) {
      sql += stringifyTemplateValue(
        template.values[i],
        pq,
        options,
        options?.reindent && /(^|\n) +$/.test(template.strings[i])
          ? template.indent
          : undefined,
      )
    }
  }

  if (
    options?.reindent &&
    template.values.length &&
    template.indent !== (parentIndent ?? '')
  ) {
    sql = sql
      .replace(new RegExp('^' + template.indent, 'gm'), parentIndent ?? '')
      .replace(/^\s+/, '')
  }

  return sql
}

export function stringifyTemplateValue(
  arg: SQLTemplateValue,
  pq: Libpq,
  options?: { reindent?: boolean },
  parentIndent?: string,
): string {
  if (!arg) {
    return ''
  }
  if (isArray(arg)) {
    return arg
      .map(value => stringifyTemplateValue(value, pq, options, parentIndent))
      .join('')
  }
  if (arg instanceof SQLTemplate) {
    return stringifyTemplate(arg, pq, options, parentIndent)
  }
  switch (arg.type) {
    case 'id':
      return pq.escapeIdentifier(arg.id)
    case 'val':
      return escapeValue(arg.value, str => pq.escapeLiteral(str))
    case 'join': {
      const list: string[] = []

      for (const value of arg.list) {
        const sql = stringifyTemplateValue(value, pq, options, parentIndent)
        if (sql) {
          list.push(sql)
        }
      }

      if (list.length > 1) {
        const separator = isString(arg.separator)
          ? arg.separator
          : stringifyTemplateValue(arg.separator, pq)

        return list.join(separator)
      }
      return list[0] ?? ''
    }
  }
}
