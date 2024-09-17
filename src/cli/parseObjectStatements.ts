import {
  $,
  ConstrType,
  FunctionParameterMode,
  parseQuery,
  splitWithScannerSync,
  walk,
} from '@pg-nano/pg-parser'
import util from 'node:util'
import type { Field } from 'pg-native'
import { select, tryit } from 'radashi'
import { debug } from './debug.js'
import { SQLIdentifier, toUniqueIdList } from './identifier.js'
import { log } from './log.js'
import type { PgBaseType } from './pgTypes.js'
import { appendCodeFrame } from './util/codeFrame.js'

const inspect = (value: any) =>
  util.inspect(value, { depth: null, colors: true })

const dump = (value: any) => debug.enabled && debug(inspect(value))

const whitespace = ' \n\t\r'

export async function parseObjectStatements(
  content: string,
  file: string,
  baseTypes: PgBaseType[],
) {
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

    // Get the line number.
    const line =
      lineBreaks.findIndex(lineBreak => location < lineBreak) + 1 ||
      lineBreaks.length

    debug('parsing statement on line', line)

    const query = content.slice(location, location + length)
    const [parseError, parseResult] = await tryit(parseQuery)(query)

    if (parseError) {
      if (isParseError(parseError)) {
        appendCodeFrame(
          parseError,
          parseError.cursorPosition,
          query,
          line,
          file,
        )
      }
      throw parseError
    }

    const node = parseResult.stmts[0].stmt

    const stmt: Omit<PgObjectStmt, 'id' | 'kind'> = {
      query,
      line,
      file,
      dependencies: new Set(),
      dependents: new Set(),
    }

    if ($.isCreateFunctionStmt(node)) {
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
        kind: 'routine',
        id,
        params: inParams,
        returnType,
        returnSet: fn.returnType?.setof ?? false,
        isProcedure: fn.is_procedure ?? false,
        ...stmt,
      })
    } else if ($.isCreateStmt(node)) {
      const { relation, tableElts } = $(node)
      if (!tableElts) {
        continue
      }

      const id = new SQLIdentifier(relation.relname, relation.schemaname)
      const columns: PgColumnDef[] = []
      const primaryKeyColumns: string[] = []

      for (const elt of tableElts) {
        if ($.isColumnDef(elt)) {
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

          const type = SQLIdentifier.fromTypeName(typeName)
          if (
            type.schema == null &&
            baseTypes.some(t => t.name === type.name)
          ) {
            type.schema = 'pg_catalog'
          }

          columns.push({
            name: colname,
            type,
            refs,
          })
        } else if ($.isConstraint(elt)) {
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
    } else if ($.isCompositeTypeStmt(node)) {
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
    } else if ($.isCreateEnumStmt(node)) {
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
    } else if ($.isViewStmt(node)) {
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
    } else if ($.isCreateExtensionStmt(node)) {
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
        $.isIndexStmt(node) ||
        $.isCreateTrigStmt(node) ||
        $.isCreateSeqStmt(node)
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
  | PgRoutineStmt
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

export interface PgRoutineStmt extends PgObjectStmt {
  kind: 'routine'
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

type ParseError = Error & { cursorPosition: number }

function isParseError(error: Error): error is ParseError {
  return 'cursorPosition' in error
}
