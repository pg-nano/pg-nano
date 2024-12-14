import fs from 'node:fs'
import path from 'node:path'
import { sift } from 'radashi'
import type { Env } from '../env.js'
import type { TopologicalSet } from '../linker/topologicalSet.js'
import type { PgObjectStmt } from '../parser/types.js'

export function prepareSchemaDir(
  env: Env,
  sortedObjectStmts: TopologicalSet<PgObjectStmt>,
) {
  fs.rmSync(env.schemaDir, { recursive: true, force: true })
  fs.mkdirSync(env.schemaDir, { recursive: true })

  const indexWidth = String(sortedObjectStmts.size).length

  let stmtIndex = 1
  for (const stmt of sortedObjectStmts) {
    const name = sift([
      String(stmtIndex++).padStart(indexWidth, '0'),
      stmt.kind === 'extension' ? stmt.kind : null,
      stmt.id.schema,
      stmt.id.name,
    ])

    const outFile = path.join(env.schemaDir, name.join('-') + '.sql')
    fs.writeFileSync(
      outFile,
      '-- file://' + stmt.file + '#L' + stmt.line + '\n' + stmt.query + ';\n',
    )
  }
}
