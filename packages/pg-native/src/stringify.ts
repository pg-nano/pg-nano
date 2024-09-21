import type Libpq from '@pg-nano/libpq'
import { isArray, isString } from 'radashi'
import { PgNativeError } from './error.js'
import { SQLTemplate, type SQLTemplateValue } from './template'
import { escapeValue } from './value.js'

export function stringifyTemplate(
  template: SQLTemplate,
  pq: Libpq,
  options?: { reindent?: boolean },
  parentIndent?: string,
): string {
  let ddl = ''

  for (let i = 0; i < template.strings.length; i++) {
    ddl += template.strings[i]

    if (i < template.values.length) {
      const hasIndent =
        options?.reindent && /(^|\n) +$/.test(template.strings[i])

      const valueString = stringifyTemplateValue(
        template.values[i],
        pq,
        options,
        hasIndent ? template.indent : undefined,
      )

      ddl += hasIndent ? valueString.replace(/^[ \t]+/, '') : valueString
    }
  }

  if (
    options?.reindent &&
    template.values.length &&
    template.indent !== (parentIndent ?? '')
  ) {
    ddl = ddl.replace(
      new RegExp('^' + template.indent, 'gm'),
      parentIndent ?? '',
    )
    // Remove leading empty lines from multi-line template strings.
    ddl = ddl.replace(/^\s*\n(?= *\S)/, '')
  }

  return ddl
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
    case 'id': {
      const escapedId = pq.escapeIdentifier(arg.id)
      if (escapedId === null) {
        throw new PgNativeError(pq.getLastErrorMessage())
      }
      return escapedId
    }
    case 'val':
      return escapeValue(arg.value, str => {
        const escapedStr = pq.escapeLiteral(str)
        if (escapedStr === null) {
          throw new PgNativeError(pq.getLastErrorMessage())
        }
        return escapedStr
      })
    case 'join': {
      const list: string[] = []
      const separator = isString(arg.separator)
        ? arg.separator.length <= 1
          ? arg.separator
          : ''
        : stringifyTemplateValue(arg.separator, pq)

      for (const value of arg.list) {
        const valueString = stringifyTemplateValue(
          value,
          pq,
          options,
          parentIndent,
        )
        if (valueString) {
          list.push(valueString)
        }
      }

      return list.join(separator)
    }
  }
}
