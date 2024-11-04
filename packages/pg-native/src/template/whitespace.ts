export const INDENT_RE = /(^|\n) +$/

/**
 * Find the indentation of the first non-empty line.
 */
export function detectIndent(text: string) {
  return text.match(/\n([ \t]+)(?:\S|$)/)?.[1]
}

export function replaceIndent(
  text: string,
  oldIndent: string,
  newIndent: string,
) {
  return text.replace(new RegExp('^' + oldIndent, 'gm'), newIndent)
}

export function stripIndent(text: string) {
  return text.replace(/^[ \t]+/, '')
}

export function removeLeadingEmptyLines(text: string) {
  return text.replace(/^\s*\n(?= *\S)/, '')
}
