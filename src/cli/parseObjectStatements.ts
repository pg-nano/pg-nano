import {
  $,
  ConstrType,
  FunctionParameterMode,
  NodeTag,
  parseQuery,
  splitWithScannerSync,
  walk,
} from '@pg-nano/pg-parser'
import util from 'node:util'
import type { Field } from 'pg-nano'
import { select } from 'radashi'
import { debug } from './debug.js'
import { SQLIdentifier, toUniqueIdList } from './identifier'
import { log } from './log'

const inspect = (value: any) =>
  util.inspect(value, { depth: null, colors: true })

const dump = (value: any) => debug.enabled && debug(inspect(value))

const whitespace = ' \n\t\r'

export async function parseObjectStatements(content: string, file: string) {
  const stmts = splitWithScannerSync(content)
  const objects: ParsedObjectStmt[] = []
  const lineBreaks = getLineBreakLocations(content)

  for (let { location, length } of stmts) {
    // Skip comments and empty lines.
    let i = location
    while (
      whitespace.includes(content[i]) ||
      content.slice(i, i + 2) === '--'
    ) {
      i = content.indexOf('\n', i + 1) + 1
    }
    length -= i - location
    location = i

    const query = content.slice(location, location + length)
    const node = (await parseQuery(query)).stmts[0].stmt

    // Get the line number.
    const line =
      lineBreaks.findIndex(lineBreak => location < lineBreak) + 1 ||
      lineBreaks.length

    const stmt: Omit<PgObjectStmt, 'id' | 'kind'> = {
      query,
      line,
      file,
      dependencies: new Set(),
      dependents: new Set(),
    }

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
              type: SQLIdentifier.fromTypeName(param.argType),
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
              type: SQLIdentifier.fromTypeName(param.argType),
            })
          }
        }
      }

      const returnType = outParams.length
        ? outParams
        : fn.returnType
          ? SQLIdentifier.fromTypeName(fn.returnType)
          : undefined

      objects.push({
        kind: 'function',
        id,
        params: inParams,
        returnType,
        returnSet: fn.returnType?.setof ?? false,
        isProcedure: fn.is_procedure ?? false,
        ...stmt,
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
          if (!colname || !typeName) {
            log.warn(
              'Skipping table column with missing %s',
              colname ? 'type' : 'name',
            )
            dump(elt)
            continue
          }

          const refs: SQLIdentifier[] = []

          if (constraints) {
            for (const constraint of constraints) {
              const { contype } = $(constraint)
              if (contype === ConstrType.CONSTR_PRIMARY) {
                primaryKeyColumns.push(colname!)
              } else if (contype === ConstrType.CONSTR_FOREIGN) {
                const { pktable } = $(constraint)
                if (pktable) {
                  refs.push(
                    new SQLIdentifier(pktable.relname, pktable.schemaname),
                  )
                }
              }
            }
          }

          columns.push({
            name: colname,
            type: SQLIdentifier.fromTypeName(typeName),
            refs,
          })
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
        kind: 'table',
        id,
        columns,
        primaryKeyColumns,
        ...stmt,
      })
    } else if (NodeTag.isCompositeTypeStmt(node)) {
      const { typevar, coldeflist } = $(node)

      const id = new SQLIdentifier(typevar.relname, typevar.schemaname)
      const columns = select(coldeflist, (col): PgColumnDef | null => {
        const { colname, typeName } = $(col)
        if (!colname || !typeName) {
          log.warn(
            'Skipping composite column with missing %s',
            colname ? 'type' : 'name',
          )
          dump(col)
          return null
        }
        return {
          name: colname,
          type: SQLIdentifier.fromTypeName(typeName),
        }
      })

      objects.push({
        kind: 'type',
        subkind: 'composite',
        id,
        columns,
        ...stmt,
      })
    } else if (NodeTag.isCreateEnumStmt(node)) {
      const { typeName, vals } = $(node)

      const id = SQLIdentifier.fromQualifiedName(typeName)
      const labels = vals.map(val => $(val).sval)

      objects.push({
        kind: 'type',
        subkind: 'enum',
        id,
        labels,
        ...stmt,
      })
    } else if (NodeTag.isViewStmt(node)) {
      const { view, query } = $(node)

      const id = new SQLIdentifier(view.relname, view.schemaname)
      const refs: SQLIdentifier[] = []

      walk(query, {
        RangeVar(path) {
          const { relname, schemaname } = path.node
          refs.push(new SQLIdentifier(relname, schemaname))
        },
        FuncCall(path) {
          const { funcname } = path.node
          refs.push(SQLIdentifier.fromQualifiedName(funcname))
        },
        TypeCast(path) {
          const { typeName } = path.node
          refs.push(SQLIdentifier.fromTypeName(typeName))
        },
      })

      objects.push({
        kind: 'view',
        id,
        refs: toUniqueIdList(
          refs.filter(
            id =>
              id.schema !== 'pg_catalog' && id.schema !== 'information_schema',
          ),
          view.schemaname,
        ),
        fields: null,
        ...stmt,
      })
    } else if (NodeTag.isCreateExtensionStmt(node)) {
      const { extname } = $(node)
      const id = new SQLIdentifier(extname)

      objects.push({
        kind: 'extension',
        id,
        ...stmt,
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
      dump(node)
    }
  }

  return objects
}

export type ParsedObjectType<T = ParsedObjectStmt> = T extends ParsedObjectStmt
  ? T['kind']
  : never

export type ParsedObjectStmt =
  | PgFunctionStmt
  | PgTableStmt
  | PgEnumStmt
  | PgCompositeTypeStmt
  | PgViewStmt
  | PgExtensionStmt

export type PgObjectStmt = {
  kind: string
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
  refs?: SQLIdentifier[]
}

export interface PgFunctionStmt extends PgObjectStmt {
  kind: 'function'
  params: PgParamDef[]
  returnType: SQLIdentifier | PgColumnDef[] | undefined
  returnSet: boolean
  isProcedure: boolean
}

export interface PgTableStmt extends PgObjectStmt {
  kind: 'table'
  columns: PgColumnDef[]
  primaryKeyColumns: string[]
}

export interface PgTypeStmt extends PgObjectStmt {
  kind: 'type'
  subkind: string
}

export interface PgEnumStmt extends PgTypeStmt {
  subkind: 'enum'
  labels: string[]
}

export interface PgCompositeTypeStmt extends PgTypeStmt {
  subkind: 'composite'
  columns: PgColumnDef[]
}

export interface PgViewStmt extends PgObjectStmt {
  kind: 'view'
  /**
   * References within the view's subquery to objects that aren't from the
   * `pg_catalog` or `information_schema` namespaces.
   */
  refs: SQLIdentifier[]
  fields: Field[] | null
}

export interface PgExtensionStmt extends PgObjectStmt {
  kind: 'extension'
}

function getLineBreakLocations(content: string) {
  const locations: number[] = []
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') {
      locations.push(i)
    }
  }
  return locations
}
