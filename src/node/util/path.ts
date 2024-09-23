import path from 'node:path'

export function cwdRelative(p: string) {
  const rel = path.relative(process.cwd(), p)
  return rel.startsWith('..') ? rel : './' + rel
}
