import {
  $,
  type ColumnDef,
  type Constraint,
  ConstrType,
  type FunctionParameter,
  FunctionParameterMode,
  parseQuery,
  type QualifiedName,
  scanSync,
  select,
  splitWithScannerSync,
  walk,
} from '@pg-nano/pg-parser'
import * as _ from 'radashi'
import { traceParser } from '../debug.js'
import { events } from '../events.js'
import type { PgBaseType } from '../inspector/types.js'
import { appendCodeFrame } from '../util/codeFrame.js'
import { parseQualifiedName, SQLIdentifier } from './identifier.js'
import { SQLTypeIdentifier } from './typeIdentifier.js'
import type {
  PgColumnDef,
  PgInsertStmt,
  PgObjectStmt,
  PgParamDef,
  PgTableColumnDef,
} from './types.js'

const whitespace = ' \n\t\r'.split('').map(c => c.charCodeAt(0))
const serialTypes = [
  'smallserial',
  'serial',
  'bigserial',
  'serial2',
  'serial4',
  'serial8',
]

export async function parseSQLStatements(
  content: string,
  file: string,
  baseTypes: PgBaseType[],
) {
  const stmts = splitWithScannerSync(content)
  const objectStmts: PgObjectStmt[] = []
  const insertStmts: PgInsertStmt[] = []

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
    const [parseError, parseResult] = await _.tryit(parseQuery)(query)

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

    const stmt: Omit<PgObjectStmt, 'id' | 'kind' | 'node'> = {
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
              type: SQLTypeIdentifier.fromTypeName(param.argType),
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
              type: SQLTypeIdentifier.fromTypeName(param.argType),
              node: param,
            })
          }
        }
      }

      const returnType = outParams.length
        ? outParams
        : fn.returnType
          ? SQLTypeIdentifier.fromTypeName(fn.returnType)
          : undefined

      objectStmts.push({
        kind: 'routine',
        node: fn,
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
      const columns: PgTableColumnDef[] = []
      const primaryKeyColumns: string[] = []
      const refs = createRefTracker()

      for (const elt of tableElts) {
        if ($.isColumnDef(elt)) {
          const { colname, typeName, constraints, collClause } = $(elt)
          if (!colname || !typeName) {
            events.emit('parser:skip-column', { columnDef: elt.ColumnDef })
            continue
          }

          const type = SQLTypeIdentifier.fromTypeName(typeName)
          if (
            type.schema == null &&
            baseTypes.some(t => t.name === type.name)
          ) {
            type.schema = 'pg_catalog'
          }
          if (type.schema === 'pg_catalog' && serialTypes.includes(type.name)) {
            throw new Error(
              `Serial types are not supported by pg-nano. Please change ${id.withField(colname).toSQL()} to a supported type.`,
            )
          }

          if (constraints) {
            for (const constraint of constraints) {
              const { contype } = $(constraint)
              if (contype === ConstrType.CONSTR_PRIMARY) {
                primaryKeyColumns.push(colname)
              } else if (contype === ConstrType.CONSTR_FOREIGN) {
                const { pktable } = $(constraint)
                if (pktable) {
                  refs.add(pktable.relname, pktable.schemaname)
                }
              } else if (contype === ConstrType.CONSTR_CHECK) {
                parseCheckConstraint(constraint.Constraint, refs)
              }
            }
          }

          columns.push({
            name: colname,
            type,
            collationName: collClause
              ? SQLIdentifier.fromQualifiedName(collClause.collname)
              : null,
            isPrimaryKey: false,
            node: elt.ColumnDef,
          })
        } else if ($.isConstraint(elt)) {
          const { contype } = $(elt)
          if (contype === ConstrType.CONSTR_PRIMARY) {
            for (const key of $(elt).keys!) {
              primaryKeyColumns.push($(key).sval)
            }
          } else if (contype === ConstrType.CONSTR_FOREIGN) {
            const { pktable, fk_attrs = [] } = $(elt)
            if (!pktable) {
              continue
            }
            for (const attr of fk_attrs) {
              const column = columns.find(c => c.name === attr.String.sval)
              if (column) {
                refs.add(pktable.relname, pktable.schemaname)
              }
            }
          } else if (contype === ConstrType.CONSTR_CHECK) {
            parseCheckConstraint(elt.Constraint, refs)
          }
        }
      }

      for (const col of columns) {
        if (primaryKeyColumns.includes(col.name)) {
          col.isPrimaryKey = true
        }
      }

      objectStmts.push({
        kind: 'table',
        node: node.CreateStmt,
        id,
        columns,
        primaryKeyColumns,
        refs: refs.toArray(),
        ...stmt,
      })
    } else if ($.isCompositeTypeStmt(node)) {
      const { typevar, coldeflist } = $(node)

      const id = new SQLIdentifier(typevar.relname, typevar.schemaname)
      const columns = _.select(
        coldeflist,
        (col): PgColumnDef<ColumnDef> | null => {
          const { colname, typeName } = $(col)
          if (!colname || !typeName) {
            events.emit('parser:skip-column', { columnDef: col.ColumnDef })
            return null
          }
          return {
            name: colname,
            type: SQLTypeIdentifier.fromTypeName(typeName),
            node: col.ColumnDef,
          }
        },
      )

      objectStmts.push({
        kind: 'type',
        subkind: 'composite',
        node: node.CompositeTypeStmt,
        id,
        columns,
        ...stmt,
      })
    } else if ($.isCreateEnumStmt(node)) {
      const { typeName, vals } = $(node)

      const id = SQLIdentifier.fromQualifiedName(typeName)
      const labels = vals.map(val => $(val).sval)

      objectStmts.push({
        kind: 'type',
        subkind: 'enum',
        node: node.CreateEnumStmt,
        id,
        labels,
        ...stmt,
      })
    } else if ($.isViewStmt(node)) {
      const { view, query } = $(node)

      const id = new SQLIdentifier(view.relname, view.schemaname)
      const refs = createRefTracker()

      walk(query, {
        RangeVar(path) {
          const { relname, schemaname } = path.node
          refs.add(relname, schemaname)
        },
        FuncCall(path) {
          const { funcname } = path.node
          refs.addQualifiedName(funcname)
        },
        TypeCast(path) {
          const { typeName } = path.node
          refs.addQualifiedName(typeName.names)
        },
      })

      objectStmts.push({
        kind: 'view',
        node: node.ViewStmt,
        id,
        refs: refs.toArray(),
        fields: null,
        ...stmt,
      })
    } else if ($.isCreateSchemaStmt(node)) {
      const { schemaname } = $(node)
      const id = new SQLIdentifier('', schemaname!)

      objectStmts.push({
        kind: 'schema',
        node: node.CreateSchemaStmt,
        id,
        ...stmt,
      })
    } else if ($.isCreateExtensionStmt(node)) {
      const { extname } = $(node)
      const id = new SQLIdentifier(extname)

      objectStmts.push({
        kind: 'extension',
        node: node.CreateExtensionStmt,
        id,
        ...stmt,
      })
    } else if ($.isInsertStmt(node)) {
      if (!select(node, 'selectStmt.valuesLists')) {
        events.emit('parser:unhandled-insert', {
          insertStmt: node.InsertStmt,
        })
        continue
      }

      const tuples: string[][] = []

      const tokens = scanSync(query)
      const valuesIndex = tokens.findIndex(token => token.kind === 'VALUES')
      for (
        let i = valuesIndex + 1,
          start = -1,
          openParens = 0,
          tuple: string[] | undefined;
        i < tokens.length;
        i++
      ) {
        let isEndOfValue: boolean | undefined

        const token = tokens[i]
        switch (token.kind) {
          case 'ASCII_40': // left paren
            start = token.end
            tuple = []
            openParens++
            break
          case 'ASCII_44': // comma
            isEndOfValue = openParens === 1
            break
          case 'ASCII_41': // right paren
            if (--openParens < 0) {
              throw new Error('Unbalanced parentheses in INSERT VALUES clause')
            }
            if (tuple && openParens === 0) {
              tuples.push(tuple)
              isEndOfValue = true
            }
            break
        }

        if (tuple && isEndOfValue) {
          tuple.push(query.slice(start, token.start).trim())
          start = token.end
        }
      }

      const { relation, cols } = $(node)

      const targetColumns =
        cols?.map(col => {
          let { name = '', indirection } = $(col)
          if (indirection) {
            name += indirection
              .map(i => {
                const index = select(i, 'sval')
                return `[${index}]`
              })
              .join('')
          }
          return name
        }) ?? null

      insertStmts.push({
        kind: 'insert',
        node: node.InsertStmt,
        relationId: new SQLIdentifier(relation.relname, relation.schemaname),
        targetColumns,
        tuples,
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

  return { objectStmts, insertStmts }
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

function parseCheckConstraint(constraint: Constraint, refs: RefTracker) {
  const { raw_expr } = $(constraint)
  if (raw_expr) {
    walk(raw_expr, {
      FuncCall(path) {
        const { funcname } = path.node
        refs.addQualifiedName(funcname)
      },
    })
  }
}

type RefTracker = ReturnType<typeof createRefTracker>

function createRefTracker() {
  const refs: SQLIdentifier[] = []
  const map: Record<string, SQLIdentifier> = {}

  return {
    add(name: string, schema: string | undefined) {
      const hash = `${schema ?? ''}.${name}`
      if (map[hash]) {
        return map[hash]
      }
      const id = new SQLIdentifier(name, schema)
      map[hash] = id
      refs.push(id)
      return id
    },
    addQualifiedName(names: QualifiedName) {
      const { name, schema } = parseQualifiedName(names)
      this.add(name, schema)
    },
    toArray() {
      return refs
    },
  }
}
