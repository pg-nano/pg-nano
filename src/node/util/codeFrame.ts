import { cwdRelative } from './path.js'

export function appendCodeFrame(
  error: Error,
  errorPosition: number,
  query: string,
  stmtLine = 1,
  stmtFile?: string,
) {
  const errorLine = query.slice(0, errorPosition).split('\n').length - 1
  const errorColumn =
    errorPosition - (1 + query.lastIndexOf('\n', errorPosition - 1))

  const queryLines = (query + ';').split('\n')
  const startLine = Math.max(0, errorLine - 2)
  const endLine = Math.min(queryLines.length - 1, errorLine + 3)
  const width = String(stmtLine + endLine).length

  let output = ''

  for (let line = startLine; line <= endLine; line++) {
    output += `${line === errorLine ? '> ' : '  '}${String(stmtLine + line).padStart(width)} | ${queryLines[line]}\n`

    if (line === errorLine) {
      output += ' '.repeat(3 + width) + `| ${' '.repeat(errorColumn - 1)}^\n`
    }
  }

  error.message =
    error.message.replace(/\nLINE \d+: [\s\S]+$/, '') +
    '\n\n' +
    output +
    (stmtFile
      ? '\n    at ' +
        cwdRelative(stmtFile) +
        ':' +
        (stmtLine + errorLine) +
        ':' +
        errorColumn
      : '')
}
