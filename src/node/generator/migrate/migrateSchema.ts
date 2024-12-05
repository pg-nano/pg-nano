import { scanSync } from '@pg-nano/pg-parser'
import { sql } from 'pg-nano'
import { SQLIdentifier } from 'pg-nano/plugin'
import type { Env } from '../../env.js'
import { events } from '../../events.js'
import { planSchemaMigration } from './planSchemaMigration.js'

export async function migrateSchema(
  env: Env,
  droppedTables: Set<SQLIdentifier>,
) {
  events.emit('migrate:plan')

  const plan = await planSchemaMigration({
    dsn: env.config.dev.connectionString,
    schemaDir: env.schemaDir,
  })

  if (!plan.statements) {
    return
  }

  events.emit('migrate:start')

  const hazards = plan.statements.flatMap(
    stmt =>
      stmt.hazards?.filter(
        hazard => !env.config.migration.allowHazards.includes(hazard.type),
      ) ?? [],
  )

  if (hazards.length > 0) {
    throw Object.assign(
      new Error(
        `Migration hazards were detected:\n${hazards
          .map(hazard => `  • ${hazard.message} (${hazard.type})`)
          .join('\n')}`,
      ),
      { code: 'MIGRATION_HAZARDS' },
    )
  }

  const sliceIdent = (query: string, token: { start: number; end: number }) => {
    const ident = query.slice(token.start, token.end)
    return ident[0] === '"' ? ident.slice(1, -1) : ident
  }

  for (const stmt of plan.statements) {
    const pg = (await env.client).extend({
      statement_timeout: stmt.timeout_ms,
      lock_timeout: stmt.lock_timeout_ms,
    })

    events.emit('mutation:apply', {
      query: stmt.ddl,
    })

    await pg.query(sql.unsafe(stmt.ddl))

    if (stmt.ddl.startsWith('DROP TABLE')) {
      const tokens = scanSync(stmt.ddl)
      const identIndex = tokens.findIndex(token => token.kind === 'IDENT')
      const periodFound = tokens[identIndex + 1]?.kind === 'ASCII_46'
      const schema = periodFound
        ? sliceIdent(stmt.ddl, tokens[identIndex])
        : undefined
      const name = sliceIdent(
        stmt.ddl,
        tokens[periodFound ? identIndex + 2 : identIndex],
      )
      droppedTables.add(new SQLIdentifier(name, schema))
    }
  }
}
