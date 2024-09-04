// Remove surrounding double quotes if present.
export function unquote(str: string) {
  if (
    str.length > 1 &&
    str.charAt(0) === '"' &&
    str.charAt(str.length - 1) === '"'
  ) {
    return str.slice(1, -1)
  }
  return str
}
