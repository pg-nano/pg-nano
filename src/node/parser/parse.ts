import {
  $,
  type ColumnDef,
  ConstrType,
  type FunctionParameter,
  FunctionParameterMode,
  parseQuery,
  splitWithScannerSync,
  walk,
} from '@pg-nano/pg-parser'
import { select, tryit } from 'radashi'
import { traceParser } from '../debug.js'
import { events } from '../events.js'
import type { PgBaseType } from '../inspector/types.js'
import { appendCodeFrame } from '../util/codeFrame.js'
import { SQLIdentifier, toUniqueIdList } from './identifier.js'
import type { PgColumnDef, PgObjectStmt, PgParamDef } from './types.js'

const whitespace = ' \n\t\r'.split('').map(c => c.charCodeAt(0))

export async function parseObjectStatements(
  content: string,
  file: string,
  baseTypes: PgBaseType[],
) {
  const stmts = splitWithScannerSync(content)

  const objects: PgObjectStmt[] = []
  const lineBreaks = getLineBreakLocations(content)

  for (const { location, length } of stmts) {
    const end = location + length
    const start = findStatementStart(content, location, end)

    // Get the line number.
    const line =
      lineBreaks.findIndex(lineBreak => start < lineBreak) + 1 ||
      lineBreaks.length

    const query = content.slice(start, end)
    if (!query) {
      continue
    }

    traceParser('parsing statement on line', line)
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
      const outParams: PgColumnDef<FunctionParameter>[] = []

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
              node: param,
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
      const columns: PgColumnDef<ColumnDef>[] = []
      const primaryKeyColumns: string[] = []

      for (const elt of tableElts) {
        if ($.isColumnDef(elt)) {
          const { colname, typeName, constraints } = $(elt)
          if (!colname || !typeName) {
            events.emit('parser:skip-column', { columnDef: elt.ColumnDef })
            continue
          }

          const refs: SQLIdentifier[] = []

          if (constraints) {
            for (const constraint of constraints) {
              const { contype } = $(constraint)
              if (contype === ConstrType.CONSTR_PRIMARY) {
                primaryKeyColumns.push(colname)
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
            node: elt.ColumnDef,
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
      const columns = select(
        coldeflist,
        (col): PgColumnDef<ColumnDef> | null => {
          const { colname, typeName } = $(col)
          if (!colname || !typeName) {
            events.emit('parser:skip-column', { columnDef: col.ColumnDef })
            return null
          }
          return {
            name: colname,
            type: SQLIdentifier.fromTypeName(typeName),
            node: col.ColumnDef,
          }
        },
      )

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

      events.emit('parser:unhandled-statement', { query, node })
    }
  }

  return objects
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

function findStatementStart(content: string, start: number, end: number) {
  let i = start
  while (true) {
    // Skip whitespace.
    if (whitespace.includes(content.charCodeAt(i))) {
      i++
    }
    // Skip single-line comments.
    else if (content.slice(i, i + 2) === '--') {
      i = content.indexOf('\n', i + 2) + 1
    }
    // Skip multi-line comments.
    else if (content.slice(i, i + 2) === '/*') {
      i = content.indexOf('*/', i + 2) + 2
    }
    // Otherwise, we've found the start of the statement.
    else {
      return Math.min(i, end)
    }
  }
}
