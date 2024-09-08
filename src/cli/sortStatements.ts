import type { ParsedStatement } from './parseStatements'

export type SortedStatement = ParsedStatement & {
  dependencies: Set<SortedStatement>
}

export function sortStatements(
  parsedStmts: ParsedStatement[],
): SortedStatement[] {
  const namedStmts = new Map<string, SortedStatement>()
  const alphaSortedStmts = parsedStmts
    .toSorted((left, right) => {
      const cmp = (left.id.schema ?? 'public').localeCompare(
        right.id.schema ?? 'public',
      )
      if (cmp !== 0) {
        return cmp
      }
      return left.id.name.localeCompare(right.id.name)
    })
    .map(stmt => {
      const sortedStmt: SortedStatement = {
        ...stmt,
        dependencies: new Set(),
      }
      namedStmts.set(stmt.id.toQualifiedName(), sortedStmt)
      return sortedStmt
    })

  // Determine dependencies
  for (const stmt of alphaSortedStmts) {
    if (stmt.type === 'function') {
      for (const param of stmt.params) {
        const dep = namedStmts.get(param.type.toQualifiedName())
        if (dep) {
          stmt.dependencies.add(dep)
        }
      }
      if (stmt.returnType) {
        const dep = namedStmts.get(stmt.returnType.toQualifiedName())
        if (dep) {
          stmt.dependencies.add(dep)
        }
      }
    } else if (
      stmt.type === 'table' ||
      (stmt.type === 'type' && stmt.subtype === 'composite')
    ) {
      for (const column of stmt.columns) {
        const dep = namedStmts.get(column.type.toQualifiedName())
        if (dep) {
          stmt.dependencies.add(dep)
        }
      }
    }
  }

  // Topological sort
  const topoSortedStmts: SortedStatement[] = []
  const visited = new Set<SortedStatement>()

  function visit(stmt: SortedStatement) {
    if (visited.has(stmt)) {
      return
    }
    visited.add(stmt)
    for (const dep of stmt.dependencies) {
      visit(dep)
    }
    topoSortedStmts.push(stmt)
  }

  for (const stmt of alphaSortedStmts) {
    visit(stmt)
  }

  return topoSortedStmts
}
