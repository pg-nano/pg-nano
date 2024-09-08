import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { type Client, sql } from 'pg-nano'
import { group, map, memo, sift } from 'radashi'
import type { Env } from './env'
import { log } from './log'
import type { SQLIdentifier } from './parseIdentifier'
import { parseStatements } from './parseStatements'
import { type SortedStatement, sortStatements } from './sortStatements'
import { dedent } from './util/dedent'

type SQLObject = {
  id: SQLIdentifier
  type: string
  stmtIndex: number
}

export async function prepareForMigration(filePaths: string[], env: Env) {
  const client = await env.client

  fs.rmSync(env.schemaDir, { recursive: true, force: true })
  fs.mkdirSync(env.schemaDir, { recursive: true })

  const { pre: prePlanFiles, rest: schemaFiles = [] } = group(
    filePaths,
    file => {
      const name = path.basename(file)
      return name[0] === '!' ? 'pre' : 'rest'
    },
  )

  let prePlanDDL = dedent`
    SET check_function_bodies = off;\n\n
  `

  if (prePlanFiles) {
    prePlanDDL +=
      prePlanFiles.map(file => fs.readFileSync(file, 'utf8')).join('\n\n') +
      '\n\n'
  }

  const parsedSchemaFiles = await map(schemaFiles, async file => {
    const content = fs.readFileSync(file, 'utf8')
    const statements = await parseStatements(content)
    return { file, statements }
  })

  const doesObjectExist = memo(async (object: SQLObject) => {
    if (object.type === 'table') {
      return await client.scalar<boolean>(sql`
        SELECT EXISTS (
          SELECT 1
          FROM pg_tables
          WHERE schemaname = ${object.id.schemaVal}
            AND tablename = ${object.id.nameVal}
        );
      `)
    }
    if (object.type === 'type') {
      return await client.scalar<boolean>(sql`
        SELECT EXISTS (
          SELECT 1
          FROM pg_type
          WHERE typname = ${object.id.nameVal}
            AND typnamespace = ${object.id.schemaVal}::regnamespace
        );
      `)
    }
    return false
  })

  const allStatements = sortStatements(
    parsedSchemaFiles.flatMap(f => f.statements),
  )

  const allTables = allStatements.filter(stmt => stmt.type === 'table')

  /** These statements must be executed before planning a migration. */
  const executedStmts = new Set<SortedStatement>()

  /** These statements won't be executed. */
  const unusedStmts: SortedStatement[] = []

  for (const stmt of allStatements) {
    // Non-enum types are not supported by pg-schema-diff, so we need to
    // diff them manually.
    if (object.type === 'type' && !stmt.match(/\bAS\s+ENUM\b/i)) {
      const typeExists = await doesObjectExist(object)
      if (!typeExists) {
        await client.query(sql.unsafe(stmt))
        stmts[i] = ''
      } else if (await hasTypeChanged(client, object, stmt)) {
        await client.query(sql`
          DROP TYPE ${object.id.toSQL()} CASCADE;
          ${sql.unsafe(stmt)}
        `)
      }
    }
  }

  if (unusedStmts.length) {
    log.warn('Unhandled statement:')
    log.warn(
      unusedStmts
        .map(({ stmt }) => {
          stmt = stmt.replace(/(^|\n) *--[^\n]+/g, '').replace(/\s+/g, ' ')
          return '  ' + (stmt.length > 50 ? stmt.slice(0, 50) + '…' : stmt)
        })
        .join('\n\n'),
    )
  }

  await client.query(sql`
    DROP SCHEMA IF EXISTS nano CASCADE;
  `)

  const prePlanFile = path.join(env.untrackedDir, 'pre-plan.sql')
  fs.writeFileSync(prePlanFile, prePlanDDL)

  return allStatements
}

function md5Hash(input: string): string {
  return crypto.createHash('md5').update(input).digest('hex')
}

/**
 * Compare a type to the existing type in the database.
 *
 * @returns `true` if the type has changed, `false` otherwise.
 */
async function hasTypeChanged(client: Client, type: SQLObject, stmt: string) {
  const tmpId = type.id.withSchema('nano')
  const tmpStmt = stmt.replace(type.id.toString(), tmpId.toString())

  // Add the current type to the database (but under the "nano" schema), so we
  // can compare it to the existing type.
  await client.query(sql`
    CREATE SCHEMA IF NOT EXISTS nano;
    DROP TYPE IF EXISTS ${tmpId.toSQL()} CASCADE;
    ${sql.unsafe(tmpStmt)}
  `)

  const selectTypeById = (id: SQLIdentifier) => sql`
    SELECT
      a.attname AS column_name,
      a.atttypid AS type_id,
      a.attnum AS column_number
    FROM
      pg_attribute a
    JOIN
      pg_type t ON t.oid = a.attrelid
    WHERE
      t.typname = ${id.nameVal}
      AND t.typnamespace = ${id.schemaVal}::regnamespace
    ORDER BY
      a.attnum
  `

  const hasChanges = await client.scalar<boolean>(
    sql`
      WITH type1 AS (
        ${selectTypeById(type.id)}
      ),
      type2 AS (
        ${selectTypeById(tmpId)}
      )
      SELECT 
        EXISTS (
          SELECT 1
          FROM (
            SELECT * FROM type1
            EXCEPT
            SELECT * FROM type2
          ) diff1
        ) OR
        EXISTS (
          SELECT 1
          FROM (
            SELECT * FROM type2
            EXCEPT
            SELECT * FROM type1
          ) diff2
        ) AS has_changes;
    `,
  )

  return hasChanges
}

/**
 * Split a string of SQL statements into individual statements. This assumes
 * your SQL is properly indented.
 */
function splitStatements(stmts: string): string[] {
  const regex = /;\s*\n(?=\S)/g
  const statements = stmts.split(regex)
  if (statements.length > 1) {
    const falsePositive = /^(BEGIN|END|\$\$)/i
    statements.forEach((stmt, i) => {
      if (falsePositive.test(stmt)) {
        // Find the previous non-empty statement and merge them.
        for (let j = i - 1; j >= 0; j--) {
          if (statements[j] === '') {
            continue
          }
          statements[j] += stmt
          break
        }
        statements[i] = ''
      }
    })
    return sift(statements).map(stmt => stmt.trim() + ';')
  }
  return statements
}
