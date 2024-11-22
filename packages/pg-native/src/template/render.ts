import type Libpq from '@pg-nano/libpq'
import { isArray, isString } from 'radashi'
import { PgNativeError } from '../error.js'
import { stringifyValue } from '../value.js'
import { type SQLTemplate, type SQLTemplateValue, SQLToken } from './token.js'
import {
  INDENT_RE,
  removeLeadingEmptyLines,
  replaceIndent,
  stripIndent,
} from './whitespace.js'

export function renderTemplate(
  input: SQLTemplate,
  pq: Libpq,
  options?: { reindent?: boolean; cache?: boolean },
  parentIndent?: string,
): string {
  let command = ''

  if (input.type !== SQLToken.Type.Template) {
    input = SQLToken.template([''], [input])
  }

  const [strings, values, indent] = input.args

  for (let i = 0; i < strings.length; i++) {
    command += strings[i]

    if (i < values.length) {
      const needsReindent = options?.reindent && INDENT_RE.test(strings[i])

      const valueString = renderTemplateValue(
        values[i],
        pq,
        options,
        needsReindent ? indent : undefined,
        input,
      )

      command += needsReindent ? stripIndent(valueString) : valueString
    }
  }

  if (options?.reindent && values.length && indent !== (parentIndent ?? '')) {
    command = replaceIndent(command, indent, parentIndent ?? '')
    command = removeLeadingEmptyLines(command)
  }

  return command
}

export function renderTemplateValue(
  input: SQLTemplateValue,
  pq: Libpq,
  options?: { reindent?: boolean },
  parentIndent?: string,
  parentTemplate?: SQLTemplate,
): string {
  if (!input) {
    return ''
  }
  if (isArray(input)) {
    return input
      .map(value => renderTemplateValue(value, pq, options, parentIndent))
      .join('')
  }
  switch (input.type) {
    case SQLToken.Type.Template: {
      if (parentTemplate) {
        input.params = parentTemplate.params
      }
      return renderTemplate(input, pq, options, parentIndent)
    }
    case SQLToken.Type.Id: {
      const escapedId = pq.escapeIdentifier(input.args[0])
      if (escapedId === null) {
        throw new PgNativeError(pq.getLastErrorMessage())
      }
      return escapedId
    }
    case SQLToken.Type.Literal: {
      const [value, inline] = input.args
      if (parentTemplate?.params && !inline) {
        return '$' + parentTemplate.params.push(stringifyValue(value))
      }
      return stringifyValue(value, str => {
        const escapedStr = pq.escapeLiteral(str)
        if (escapedStr === null) {
          throw new PgNativeError(pq.getLastErrorMessage())
        }
        return escapedStr
      })
    }
    case SQLToken.Type.Join: {
      const [values, separatorToken] = input.args

      const list: string[] = []
      const separator = isString(separatorToken)
        ? separatorToken.length <= 1
          ? separatorToken
          : ''
        : renderTemplateValue(separatorToken, pq)

      for (const value of values) {
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
    case SQLToken.Type.Unsafe: {
      return input.args[0]
    }
  }
}
