import {
  $,
  ConstrType,
  FunctionParameterMode,
  NodeTag,
  parseQuery,
  splitWithScannerSync,
} from '@pg-nano/pg-parser'
import util from 'node:util'
import { SQLIdentifier } from './identifier'
import { log } from './log'

const inspect = (value: any) =>
  util.inspect(value, { depth: null, colors: true })

const whitespace = ' \n\t\r'

export async function parseObjectStatements(sql: string, file: string) {
  const stmts = splitWithScannerSync(sql)
  const objects: ParsedObjectStmt[] = []
  const lineBreaks = getLineBreakLocations(sql)

  for (let { location, length } of stmts) {
    // Skip comments and empty lines.
    let i = location
    while (whitespace.includes(sql[i]) || sql.slice(i, i + 2) === '--') {
      i = sql.indexOf('\n', i + 1) + 1
    }
    length -= i - location
    location = i

    const query = sql.slice(location, location + length)
    const node = (await parseQuery(query)).stmts[0].stmt

    // Get the line number.
    const line =
      lineBreaks.findIndex(lineBreak => location < lineBreak) + 1 ||
      lineBreaks.length

    if (NodeTag.isCreateFunctionStmt(node)) {
      const fn = node.CreateFunctionStmt
      const id = SQLIdentifier.fromQualifiedName(fn.funcname)

      const inParams: PgParamDef[] = []
      const outParams: PgColumnDef[] = []

      if (fn.parameters) {
        for (const { FunctionParameter: param } of fn.parameters) {
          if (
            param.mode !== FunctionParameterMode.FUNC_PARAM_OUT &&
            param.mode !== FunctionParameterMode.FUNC_PARAM_TABLE
          ) {
            inParams.push({
              name: param.name,
              type: SQLIdentifier.fromQualifiedName(param.argType.names),
              variadic:
                param.mode === FunctionParameterMode.FUNC_PARAM_VARIADIC,
            })
          }
          if (
            param.mode === FunctionParameterMode.FUNC_PARAM_OUT ||
            param.mode === FunctionParameterMode.FUNC_PARAM_INOUT ||
            param.mode === FunctionParameterMode.FUNC_PARAM_TABLE
          ) {
            outParams.push({
              name: param.name!,
              type: SQLIdentifier.fromQualifiedName(param.argType.names),
            })
          }
        }
      }

      const returnType = outParams.length
        ? outParams
        : fn.returnType
          ? SQLIdentifier.fromQualifiedName(fn.returnType.names)
          : undefined

      objects.push({
        type: 'function',
        id,
        params: inParams,
        returnType,
        returnSet: fn.returnType?.setof ?? false,
        isProcedure: fn.is_procedure ?? false,
        query,
        line,
        file,
        dependencies: new Set(),
        dependents: new Set(),
      })
    } else if (NodeTag.isCreateStmt(node)) {
      const { relation, tableElts } = $(node)
      if (!tableElts) {
        continue
      }

      const id = new SQLIdentifier(relation.relname, relation.schemaname)
      const columns: PgColumnDef[] = []
      const primaryKeyColumns: string[] = []

      for (const elt of tableElts) {
        if (NodeTag.isColumnDef(elt)) {
          const { colname, typeName, constraints } = $(elt)
          columns.push({
            name: colname!,
            type: SQLIdentifier.fromQualifiedName(typeName!.names!),
          })
          if (constraints) {
            for (const constraint of constraints) {
              const { contype } = $(constraint)
              if (contype === ConstrType.CONSTR_PRIMARY) {
                primaryKeyColumns.push(colname!)
              }
            }
          }
        } else if (NodeTag.isConstraint(elt)) {
          const { contype } = $(elt)
          if (contype === ConstrType.CONSTR_PRIMARY) {
            for (const key of $(elt).keys!) {
              primaryKeyColumns.push($(key).sval)
            }
          }
        }
      }

      objects.push({
        type: 'table',
        id,
        columns,
        primaryKeyColumns,
        query,
        line,
        file,
        dependencies: new Set(),
        dependents: new Set(),
      })
    } else if (NodeTag.isCompositeTypeStmt(node)) {
      const { typevar, coldeflist } = $(node)

      const id = new SQLIdentifier(typevar.relname, typevar.schemaname)
      const columns = coldeflist.map(col => ({
        name: $(col).colname!,
        type: SQLIdentifier.fromQualifiedName($(col).typeName!.names!),
      }))

      objects.push({
        type: 'type',
        subtype: 'composite',
        id,
        columns,
        query,
        line,
        file,
        dependencies: new Set(),
        dependents: new Set(),
      })
    } else if (NodeTag.isCreateEnumStmt(node)) {
      const { typeName, vals } = $(node)

      const id = SQLIdentifier.fromQualifiedName(typeName)
      const labels = vals.map(val => $(val).sval)

      objects.push({
        type: 'type',
        subtype: 'enum',
        id,
        labels,
        query,
        line,
        file,
        dependencies: new Set(),
        dependents: new Set(),
      })
    } else if (NodeTag.isViewStmt(node)) {
      const { view } = $(node)
      const id = new SQLIdentifier(view.relname, view.schemaname)

      objects.push({
        type: 'view',
        id,
        query,
        line,
        file,
        dependencies: new Set(),
        dependents: new Set(),
      })
    } else if (NodeTag.isCreateExtensionStmt(node)) {
      const { extname } = $(node)
      const id = new SQLIdentifier(extname)

      objects.push({
        type: 'extension',
        id,
        query,
        line,
        file,
        dependencies: new Set(),
        dependents: new Set(),
      })
    } else {
      // These are handled by pg-schema-diff.
      if (
        NodeTag.isIndexStmt(node) ||
        NodeTag.isCreateTrigStmt(node) ||
        NodeTag.isCreateSeqStmt(node)
      ) {
        continue
      }

      const cleanedStmt = query
        .replace(/(^|\n) *--[^\n]+/g, '')
        .replace(/\s+/g, ' ')

      log.warn('Unhandled statement:')
      log.warn(
        '  ' +
          (cleanedStmt.length > 50
            ? cleanedStmt.slice(0, 50) + '…'
            : cleanedStmt),
      )
    }
  }

  return objects
}

export type ParsedObjectType<T = ParsedObjectStmt> = T extends ParsedObjectStmt
  ? T['type']
  : never

export type ParsedObjectStmt =
  | PgFunctionStmt
  | PgTableStmt
  | PgEnumStmt
  | PgCompositeTypeStmt
  | PgViewStmt
  | PgExtensionStmt

export type PgObjectStmt = {
  type: string
  id: SQLIdentifier
  query: string
  line: number
  file: string
  dependencies: Set<ParsedObjectStmt>
  dependents: Set<ParsedObjectStmt>
}

export type PgParamDef = {
  name: string | undefined
  type: SQLIdentifier
  variadic: boolean
}

export type PgColumnDef = {
  name: string
  type: SQLIdentifier
}

export interface PgFunctionStmt extends PgObjectStmt {
  type: 'function'
  params: PgParamDef[]
  returnType: SQLIdentifier | PgColumnDef[] | undefined
  returnSet: boolean
  isProcedure: boolean
}

export interface PgTableStmt extends PgObjectStmt {
  type: 'table'
  columns: PgColumnDef[]
  primaryKeyColumns: string[]
}

export interface PgTypeStmt extends PgObjectStmt {
  type: 'type'
  subtype: string
}

export interface PgEnumStmt extends PgTypeStmt {
  subtype: 'enum'
  labels: string[]
}

export interface PgCompositeTypeStmt extends PgTypeStmt {
  subtype: 'composite'
  columns: PgColumnDef[]
}

export interface PgViewStmt extends PgObjectStmt {
  type: 'view'
}

export interface PgExtensionStmt extends PgObjectStmt {
  type: 'extension'
}

function getLineBreakLocations(sql: string) {
  const locations: number[] = []
  for (let i = 0; i < sql.length; i++) {
    if (sql[i] === '\n') {
      locations.push(i)
    }
  }
  return locations
}
