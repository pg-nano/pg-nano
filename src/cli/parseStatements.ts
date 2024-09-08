import {
  $,
  NodeTag,
  parseQuery,
  splitWithScannerSync,
} from '@pg-nano/pg-parser'
import util from 'node:util'
import { SQLIdentifier } from './parseIdentifier'

const inspect = (value: any) =>
  util.inspect(value, { depth: null, colors: true })

export async function parseStatements(sql: string) {
  const stmts = splitWithScannerSync(sql)
  const parsed: ParsedStatement[] = []

  for (const { location, length } of stmts) {
    const stmt = sql.slice(location, location + length)
    const node = (await parseQuery(stmt)).stmts[0].stmt

    if (NodeTag.isCreateFunctionStmt(node)) {
      const fn = node.CreateFunctionStmt
      const id = SQLIdentifier.fromQualifiedName(fn.funcname)

      const params =
        fn.parameters?.map(({ FunctionParameter: param }) => ({
          name: param.name,
          type: SQLIdentifier.fromQualifiedName(param.argType.names),
        })) ?? []

      const returnType = fn.returnType
        ? SQLIdentifier.fromQualifiedName(fn.returnType.names)
        : undefined

      parsed.push({
        type: 'function',
        stmt,
        id,
        params,
        returnType,
      })
    } else if (NodeTag.isCreateStmt(node)) {
      const { relation, tableElts } = $(node)
      if (!tableElts) {
        continue
      }

      const id = new SQLIdentifier(relation.relname, relation.schemaname)
      const columns = tableElts
        .filter(col => NodeTag.isColumnDef(col))
        .map(col => ({
          name: $(col).colname!,
          type: SQLIdentifier.fromQualifiedName($(col).typeName!.names!),
        }))

      parsed.push({
        type: 'table',
        stmt,
        id,
        columns,
      })
    } else if (NodeTag.isViewStmt(node)) {
      const { view } = $(node)
      const id = new SQLIdentifier(view.relname, view.schemaname)

      parsed.push({
        type: 'view',
        stmt,
        id,
      })
    } else if (NodeTag.isCompositeTypeStmt(node)) {
      const { typevar, coldeflist } = $(node)

      const id = new SQLIdentifier(typevar.relname, typevar.schemaname)
      const columns = coldeflist.map(col => ({
        name: $(col).colname!,
        type: SQLIdentifier.fromQualifiedName($(col).typeName!.names!),
      }))

      parsed.push({
        type: 'type',
        subtype: 'composite',
        stmt,
        id,
        columns,
      })
    } else {
    }
  }

  // console.log(inspect(parsed))
  return parsed
}

export type ParsedStatement =
  | PgFunctionStmt
  | PgTableStmt
  | PgCompositeTypeStmt
  | PgViewStmt

export type PgCreateStmt = {
  type: string
  stmt: string
  id: SQLIdentifier
}

export interface PgFunctionStmt extends PgCreateStmt {
  type: 'function'
  params: {
    name: string | undefined
    type: SQLIdentifier
  }[]
  returnType: SQLIdentifier | undefined
}

export interface PgTableStmt extends PgCreateStmt {
  type: 'table'
  columns: {
    name: string
    type: SQLIdentifier
  }[]
}

export interface PgCompositeTypeStmt extends PgCreateStmt {
  type: 'type'
  subtype: 'composite'
  columns: {
    name: string
    type: SQLIdentifier
  }[]
}

export interface PgViewStmt extends PgCreateStmt {
  type: 'view'
}
