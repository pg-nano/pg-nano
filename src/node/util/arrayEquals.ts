export function arrayEquals(
  a: unknown[] | null | undefined,
  b: unknown[] | null | undefined,
): boolean {
  if (!a) {
    return !b
  }
  if (!b) {
    return false
  }
  return (
    a === b ||
    (a.length === b.length && a.every((val, index) => Object.is(val, b[index])))
  )
}
