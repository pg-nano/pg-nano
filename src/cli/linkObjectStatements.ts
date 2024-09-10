import { ExecutionQueue } from './executionQueue.js'
import { SQLIdentifier } from './identifier.js'
import type { ParsedObjectStmt } from './parseObjectStatements'

export function linkObjectStatements(objects: ParsedObjectStmt[]) {
  const objectsByName = new Map<string, ParsedObjectStmt>()

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

  // Determine dependencies
  for (const stmt of idSortedObjects) {
    if (stmt.type === 'function') {
      for (const param of stmt.params) {
        const dep = objectsByName.get(param.type.toQualifiedName())
        if (dep) {
          stmt.dependencies.add(dep)
        }
      }
      if (!stmt.returnType) {
        continue
      }
      if (stmt.returnType instanceof SQLIdentifier) {
        const dep = objectsByName.get(stmt.returnType.toQualifiedName())
        if (dep) {
          stmt.dependencies.add(dep)
        }
      } else {
        for (const columnDef of stmt.returnType) {
          const dep = objectsByName.get(columnDef.type.toQualifiedName())
          if (dep) {
            stmt.dependencies.add(dep)
          }
        }
      }
    } else if (
      stmt.type === 'table' ||
      (stmt.type === 'type' && stmt.subtype === 'composite')
    ) {
      for (const column of stmt.columns) {
        const dep = objectsByName.get(column.type.toQualifiedName())
        if (dep) {
          stmt.dependencies.add(dep)
        }
      }
    }
  }

  return new ExecutionQueue(objects)
}
