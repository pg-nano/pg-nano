import MagicString from 'magic-string'
import { type PgObject, PgObjectType, type Plugin } from 'pg-nano/plugin'
import { select } from 'radashi'
import * as ts from 'typescript'
import { TypeScriptToTypeBox } from './typebox-codegen/typescript/generator'

export default function (): Plugin {
  return {
    name: '@pg-nano/plugin-typebox',
    async generateEnd(
      { renderedObjects, imports, foreignImports, prelude },
      config,
    ) {
      const builtinTypes = select(
        [...imports],
        imported => {
          // The pg-nano types will be replaced by our own types.
          imports.delete(imported)

          return imported.replace('type ', '')
        },
        imported => imported.startsWith('type '),
      )

      if (builtinTypes.length > 0) {
        const names = builtinTypes.join(', ')

        // Import our own types and re-export them.
        foreignImports.add(`{ ${names} } from '@pg-nano/plugin-typebox/types'`)
        prelude.push(`export { ${names} }`)
      }

      foreignImports.add(
        `{ type Static, type SchemaOptions, Type } from '@sinclair/typebox'`,
      )

      for (const [object, code] of renderedObjects) {
        if (object.type === PgObjectType.Routine) {
          continue
        }
        const output = TypeScriptToTypeBox.Generate(code, {
          useTypeBoxImport: false,
          useExportEverything: true,
        })
        renderedObjects.set(object, fixTypeBoxOutput(output, object))
      }
    },
  }
}

// This enables compatiblity with @pg-nano/plugin-crud, which uses `declare
// namespace` to define types like `Foo.InsertParams` where another type `Foo`
// also exists.
function fixTypeBoxOutput(input: string, object: PgObject) {
  const source = ts.createSourceFile(
    'types.ts',
    input,
    ts.ScriptTarget.ESNext,
    true,
  )
  const output = new MagicString(input)
  if (object.type === PgObjectType.Table) {
    fixNameCollisions(source, output)
    fixStaticTypeQueries(source, output)
    prependArrowFunctions(source, output)
  }
  return output.toString()
}

function fixStaticTypeQueries(source: ts.SourceFile, output: MagicString) {
  function processNode(node: ts.Node) {
    if (ts.isTypeAliasDeclaration(node)) {
      // Skip any type query not wrapped with `Static<...>`
      const typeQuery = findTypeQuery(
        node,
        node =>
          ts.isTypeReferenceNode(node.parent) &&
          ts.isIdentifier(node.parent.typeName) &&
          node.parent.typeName.text === 'Static',
      )
      if (typeQuery) {
        const typeQueryStart = typeQuery.getStart(source)
        output.appendLeft(typeQueryStart, 'ReturnType<')
        const typeQueryEnd = typeQuery.getEnd()
        output.appendRight(typeQueryEnd, '>')
      }
    } else if (ts.isModuleDeclaration(node)) {
      ts.forEachChild(node.body!, processNode)
    }
  }

  for (const statement of source.statements) {
    processNode(statement)
  }
}

function prependArrowFunctions(source: ts.SourceFile, output: MagicString) {
  for (const statement of source.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        prependArrowFunction(decl, output)
      }
    }
  }
}

function prependArrowFunction(
  decl: ts.VariableDeclaration,
  output: MagicString,
) {
  if (decl.initializer) {
    // If the initializer is not a call expression, skip it.
    if (!ts.isCallExpression(decl.initializer)) {
      return
    }

    const initializerStart = decl.initializer.getStart()
    output.appendRight(initializerStart, '(options?: SchemaOptions) => ')

    // Pass the options as the last argument of the call expression.
    const callExpr = decl.initializer as ts.CallExpression
    const lastArgument = callExpr.arguments[callExpr.arguments.length - 1]
    output.appendRight(lastArgument.getEnd(), ', options')
  }
}

function fixNameCollisions(source: ts.SourceFile, output: MagicString) {
  const conflicts = findConflictingStmts(source)
  for (const conflict of conflicts) {
    const name = conflict.moduleDeclaration.name.text

    // Rewrite "export module" to "export declare namespace" to avoid runtime
    // naming collisions.
    const start = conflict.moduleDeclaration.getStart()
    const end = start + 'export module'.length
    output.overwrite(start, end, 'export declare namespace')

    // Any variable declarations inside the module declaration need to be moved
    // after the module declaration, since `declare namespace` forbids them.
    const moduleBody = conflict.moduleDeclaration.body
    if (moduleBody && ts.isModuleBlock(moduleBody)) {
      const varNames = new Set<string>()

      for (const stmt of moduleBody.statements) {
        if (ts.isVariableStatement(stmt)) {
          const varDecl = stmt.declarationList.declarations[0]

          if (ts.isIdentifier(varDecl.name) && varDecl.initializer) {
            varNames.add(varDecl.name.text)
            prependArrowFunction(varDecl, output)
            output.remove(stmt.getStart(), varDecl.initializer.getStart())
            output.move(
              varDecl.initializer.getStart(),
              varDecl.initializer.getEnd(),
              moduleBody.end,
            )
            output.appendLeft(
              moduleBody.end,
              '\n' + name + '.' + varDecl.name.text + ' = ',
            )
            output.appendRight(moduleBody.end, '\n\n')
          }
        }
      }

      for (const stmt of moduleBody.statements) {
        if (ts.isTypeAliasDeclaration(stmt)) {
          const typeName = stmt.name.text
          if (varNames.has(typeName)) {
            ts.forEachChild(stmt.type, function visit(node: ts.Node) {
              if (ts.isIdentifier(node) && node.text === typeName) {
                output.appendRight(node.getStart(), name + '.')
              }
              ts.forEachChild(node, visit)
            })
          }
        }
      }
    }
  }
}

function findTypeQuery(
  rootNode: ts.Node,
  test: (type: ts.TypeQueryNode) => boolean,
): ts.TypeQueryNode | null {
  function walk(node: ts.Node): ts.TypeQueryNode | null {
    if (ts.isTypeQueryNode(node) && test(node)) {
      return node
    }
    return ts.forEachChild(node, walk) || null
  }
  return walk(rootNode)
}

function findConflictingStmts(source: ts.SourceFile) {
  type StatementConflict = {
    typeDeclaration?: ts.TypeAliasDeclaration
    variableDeclaration?: ts.VariableDeclaration
    moduleDeclaration?: ts.ModuleDeclaration
  }
  const conflictMap = new Map<string, StatementConflict>()
  for (const stmt of source.statements) {
    if (
      ts.isVariableStatement(stmt) &&
      stmt.declarationList.declarations.length === 1
    ) {
      const varDecl = stmt.declarationList.declarations[0]
      if (ts.isIdentifier(varDecl.name)) {
        const varName = varDecl.name.text
        const conflict = conflictMap.get(varName) ?? {}
        conflict.variableDeclaration = varDecl
        conflictMap.set(varName, conflict)
      }
    } else if (ts.isModuleDeclaration(stmt) && ts.isIdentifier(stmt.name)) {
      const moduleName = stmt.name.text
      const conflict = conflictMap.get(moduleName) ?? {}
      conflict.moduleDeclaration = stmt
      conflictMap.set(moduleName, conflict)
    } else if (ts.isTypeAliasDeclaration(stmt)) {
      const typeName = stmt.name.text
      const conflict = conflictMap.get(typeName) ?? {}
      conflict.typeDeclaration = stmt
      conflictMap.set(typeName, conflict)
    }
  }
  return Array.from(conflictMap.values()).filter(
    entry =>
      entry.variableDeclaration &&
      entry.moduleDeclaration &&
      entry.typeDeclaration,
  ) as Required<StatementConflict>[]
}
