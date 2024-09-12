import type { PgViewStmt } from './parseObjectStatements.ts'

export function parseViewSubquery(view: PgViewStmt) {
  return view.query
    .replace(/^\s*CREATE\s+(.*?)\bVIEW\s+.+?\bAS\s+(?=SELECT|VALUES)/i, '')
    .replace(/\s+WITH\s+(?:(CASCADED|LOCAL)\s+)?CHECK\s+OPTION\s*$/i, '')
}
