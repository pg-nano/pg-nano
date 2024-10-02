import { SQLIdentifier } from '../parser/identifier.js'
import type { PgObjectStmt } from '../parser/types.js'
import { ExecutionQueue } from './executionQueue.js'

export function linkObjectStatements(objects: PgObjectStmt[]) {
  const objectsByName = new Map<string, PgObjectStmt>()

  const idSortedObjects = objects.toSorted((left, right) => {
    const cmp = (left.id.schema ?? 'public').localeCompare(
      right.id.schema ?? 'public',
    )
    if (cmp !== 0) {
      return cmp
    }
    return left.id.name.localeCompare(right.id.name)
  })

  for (const object of idSortedObjects) {
    objectsByName.set(object.id.toQualifiedName(), object)
  }

  const link = (stmt: PgObjectStmt, id: SQLIdentifier) => {
    const dep = objectsByName.get(id.toQualifiedName())
    if (dep) {
      stmt.dependencies.add(dep)
      dep.dependents.add(stmt)
    }
  }

  // Determine dependencies
  for (const stmt of idSortedObjects) {
    if (stmt.kind === 'routine') {
      for (const param of stmt.params) {
        link(stmt, param.type)
      }
      if (!stmt.returnType) {
        continue
      }
      if (stmt.returnType instanceof SQLIdentifier) {
        link(stmt, stmt.returnType)
      } else {
        for (const columnDef of stmt.returnType) {
          link(stmt, columnDef.type)
        }
      }
    } else if (
      stmt.kind === 'table' ||
      (stmt.kind === 'type' && stmt.subkind === 'composite')
    ) {
      for (const column of stmt.columns) {
        link(stmt, column.type)
        if (column.refs) {
          for (const ref of column.refs) {
            link(stmt, ref)
          }
        }
      }
    } else if (stmt.kind === 'view') {
      for (const ref of stmt.refs) {
        link(stmt, ref)
      }
    }
  }

  return new ExecutionQueue(idSortedObjects)
}
