import type Libpq from '@pg-nano/libpq'
import { isArray, isString } from 'radashi'
import { PgNativeError } from '../error.js'
import { SQLTemplate, type SQLTemplateValue } from '../template.js'
import { stringifyValue } from '../value.js'
import {
  INDENT_RE,
  removeLeadingEmptyLines,
  replaceIndent,
  stripIndent,
} from './whitespace.js'

export function renderTemplate(
  template: SQLTemplate,
  pq: Libpq,
  options?: { reindent?: boolean; cache?: boolean },
  parentIndent?: string,
): string {
  let command = ''

  for (let i = 0; i < template.strings.length; i++) {
    command += template.strings[i]

    if (i < template.values.length) {
      const needsReindent =
        options?.reindent && INDENT_RE.test(template.strings[i])

      const valueString = renderTemplateValue(
        template.values[i],
        pq,
        options,
        needsReindent ? template.indent : undefined,
        template,
      )

      command += needsReindent ? stripIndent(valueString) : valueString
    }
  }

  if (
    options?.reindent &&
    template.values.length &&
    template.indent !== (parentIndent ?? '')
  ) {
    command = replaceIndent(command, template.indent, parentIndent ?? '')
    command = removeLeadingEmptyLines(command)
  }

  return command
}

export function renderTemplateValue(
  arg: SQLTemplateValue,
  pq: Libpq,
  options?: { reindent?: boolean },
  parentIndent?: string,
  parentTemplate?: SQLTemplate,
): string {
  if (!arg) {
    return ''
  }
  if (isArray(arg)) {
    return arg
      .map(value => renderTemplateValue(value, pq, options, parentIndent))
      .join('')
  }
  if (SQLTemplate.isTemplate(arg)) {
    if (parentTemplate) {
      arg.params = parentTemplate.params
    }
    return renderTemplate(arg, pq, options, parentIndent)
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
      if (parentTemplate?.params && !arg.inline) {
        return '$' + parentTemplate.params.push(stringifyValue(arg.value))
      }
      return stringifyValue(arg.value, str => {
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
        : renderTemplateValue(arg.separator, pq)

      for (const value of arg.list) {
        const valueString = renderTemplateValue(
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
    default: {
      const constructor = (arg as any)?.constructor
      throw new Error(
        'Unsupported template value: ' + (constructor?.name || typeof arg),
      )
    }
  }
}
