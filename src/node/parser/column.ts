import { $, scanSync, select } from '@pg-nano/pg-parser'
import type { PgTableColumnDef, PgTableStmt } from './types.js'

/**
 * Given a column node and its table statement, extract the part of the query
 * that defines the column's name, type, and constraints.
 */
export function extractColumnDefinition(
  col: PgTableColumnDef,
  table: PgTableStmt,
): string {
  const index = table.node.tableElts!.findIndex(
    elt => $.isColumnDef(elt) && elt.ColumnDef === col.node,
  )
  const nextSiblingLocation = select(
    table.node.tableElts![index + 1],
    'location',
  )

  const query = table.query.slice(col.node.location, nextSiblingLocation)
  const tokens = scanSync(query)

  const endTokenKind = nextSiblingLocation
    ? 'ASCII_44' // comma
    : 'ASCII_41' // closing parenthesis

  // Search for the end token, starting at the end.
  const endTokenIdx = tokens.findLastIndex(token => token.kind === endTokenKind)

  if (endTokenIdx === -1) {
    throw new Error('Could not find end token for column definition')
  }

  return query.slice(0, tokens[endTokenIdx - 1].end)
}
