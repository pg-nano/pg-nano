import { PgResultError } from 'pg-native'
import { cwdRelative } from '../util/path.js'

export function throwFormattedQueryError(
  error: Error,
  stmt: { file: string; line: number; query: string },
  mapMessage?: (message: string) => string,
): never {
  let message = error.message.replace(/^ERROR:\s+/i, '').trimEnd()

  // Remove "LINE XXX: " if present, and the same number of characters from
  // any lines that come after.
  const messageLines = message.split('\n')
  for (let i = 0; i < messageLines.length; i++) {
    if (messageLines[i].startsWith('LINE ')) {
      const colonIndex = messageLines[i].indexOf(':') + 2
      messageLines[i] =
        ' '.repeat(colonIndex) + messageLines[i].slice(colonIndex)
      message = messageLines.join('\n')
      break
    }
  }

  if (mapMessage) {
    message = mapMessage(message)
  }

  const line =
    error instanceof PgResultError && error.statementPosition
      ? stmt.line -
        1 +
        getLineFromPosition(
          Number.parseInt(error.statementPosition),
          stmt.query,
        )
      : stmt.line

  const stack =
    '\n    at ' +
    cwdRelative(stmt.file) +
    ':' +
    line +
    (error.stack
      ?.replace(error.name + ': ' + error.message, '')
      .replace(/^\s*(?=\n)/, '') ?? '')

  error.message = message
  error.stack = message + stack
  throw error
}

function getLineFromPosition(position: number, query: string) {
  let line = 1
  for (let i = 0; i < position; i++) {
    if (query[i] === '\n') {
      line++
    }
  }
  return line
}
