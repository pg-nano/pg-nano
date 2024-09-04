export type Identifier = {
  name: string
  schema: string | undefined
  endOffset: number
}

export function parseIdentifier(sql: string, startOffset = 0): Identifier {
  let schema: string | undefined
  let name = ''

  let inQuotes = false
  let cursor = startOffset

  while (cursor < sql.length) {
    const char = sql[cursor]

    if (char === '"') {
      if (inQuotes && sql[cursor + 1] === '"') {
        // Escaped quote inside quoted identifier
        name += '"'
        cursor += 2
      } else {
        // Toggle quote state
        inQuotes = !inQuotes
        cursor++
      }
    } else if (!inQuotes && (char === '.' || /\s/.test(char))) {
      if (char === '.') {
        // Namespace separator
        if (schema) {
          schema += '.' + name
        } else {
          schema = name
        }
        name = ''
        cursor++
      } else {
        // End of identifier
        break
      }
    } else {
      name += char
      cursor++
    }
  }

  return {
    name,
    schema,
    endOffset: cursor,
  }
}
