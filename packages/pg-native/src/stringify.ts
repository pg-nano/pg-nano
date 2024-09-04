import type Libpq from '@pg-nano/libpq'
import { isArray } from 'radashi'
import { dedent } from '../../../src/cli/util/dedent.js'
import { debug } from './debug'
import type { SQLTemplate, SQLTemplateValue } from './template'

export function stringifyTemplate(
  template: SQLTemplate,
  pq: Libpq,
  indent?: string,
) {
  let sql = ''
  for (let i = 0; i < template.strings.length; i++) {
    sql += template.strings[i]

    if (i < template.values.length) {
      const indent = debug.enabled
        ? template.strings[i].match(/\n( +)$/)
        : undefined

      sql += stringifyTemplateValue(template.values[i], pq, indent?.[1])
    }
  }
  if (debug.enabled) {
    sql = dedent(sql)
    if (indent) {
      sql = sql.replace(/\n/g, '\n' + indent)
    }
  }
  return sql
}

export function stringifyTemplateValue(
  arg: SQLTemplateValue,
  pq: Libpq,
  indent?: string,
) {
  if (!arg) {
    return ''
  }
  if (isArray(arg)) {
    return arg
      .map(value => stringifyTemplateValue(value, pq, indent))
      .join(', ')
  }
  if ('strings' in arg) {
    return stringifyTemplate(arg, pq, indent)
  }
  switch (arg.type) {
    case 'id':
      return pq.escapeIdentifier(arg.value)
    case 'val':
      return pq.escapeLiteral(arg.value)
    case 'raw':
      return arg.value
  }
}
