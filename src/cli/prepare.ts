import fs from 'node:fs'
import path from 'node:path'
import { sql } from 'pg-nano'
import { group, map, memo } from 'radashi'
import type { Env } from './env'
import type { SQLIdentifier } from './parseIdentifier'
import { parseStatements } from './parseStatements'
import { type SortedStatement, sortStatements } from './sortStatements'
import { dedent } from './util/dedent'

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

  const objectExistence = {
    table: {
      from: 'pg_tables',
      schemaKey: 'schemaname',
      nameKey: 'tablename',
    },
    type: {
      from: 'pg_type',
      schemaKey: 'typnamespace',
      nameKey: 'typname',
    },
    function: {
      from: 'pg_proc',
      schemaKey: 'pronamespace',
      nameKey: 'proname',
    },
    view: {
      from: 'pg_views',
      schemaKey: 'schemaname',
      nameKey: 'viewname',
    },
    sequence: {
      from: 'pg_sequences',
      schemaKey: 'schemaname',
      nameKey: 'sequencename',
    },
    extension: {
      from: 'pg_extension',
      schemaKey: 'extnamespace',
      nameKey: 'extname',
    },
  }

  const doesObjectExist = memo(
    (type: keyof typeof objectExistence, id: SQLIdentifier) => {
      const { from, schemaKey, nameKey } = objectExistence[type]
      return client.queryOneColumn<boolean>(sql`
        SELECT EXISTS (
          SELECT 1
          FROM ${sql.id(from)}
          WHERE ${sql.id(schemaKey)} = ${id.schemaVal}
            AND ${sql.id(nameKey)} = ${id.nameVal}
        );
      `)
    },
  )

  const allStatements = sortStatements(
    parsedSchemaFiles.flatMap(f => f.statements),
  )

  const allTables = allStatements.filter(stmt => stmt.type === 'table')

  /** These statements must be executed before planning a migration. */
  const executionQueue = new Set<SortedStatement>()

  /** These statements won't be executed. */
  const unusedStmts: SortedStatement[] = []

  for (const stmt of allStatements) {
    for (const dep of stmt.dependencies) {
      if (dep.type in objectExistence) {
        executionQueue.add(dep)
      } else {
        console.warn('Missing dependency: %s (%s)', dep.id.toString(), dep.type)
      }
    }
  }

  // The "nano" schema is used to store temporary objects during diffing.
  await client.query(sql`
    DROP SCHEMA IF EXISTS nano CASCADE;
    CREATE SCHEMA nano;
  `)

  const objectDiffing = {
    type: async (stmt: SortedStatement) => {},
  }

  for (const stmt of executionQueue) {
    const objectExists = await doesObjectExist(stmt.type, stmt.id)

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

  // Drop the "nano" schema now that diffing is complete.
  await client.query(sql`
    DROP SCHEMA IF EXISTS nano CASCADE;
  `)

  const prePlanFile = path.join(env.untrackedDir, 'pre-plan.sql')
  fs.writeFileSync(prePlanFile, prePlanDDL)

  return allStatements
}
