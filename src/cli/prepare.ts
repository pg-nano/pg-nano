import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { type Client, sql } from 'pg-nano'
import { group, sift } from 'radashi'
import type { Env } from './env'
import { log } from './log'
import { parseIdentifier } from './parseIdentifier'
import { dedent } from './util/dedent'

type SQLObject = { name: string; stmt: string }
type SQLFunc = SQLObject & { signature: string }

export async function prepareForMigration(filePaths: string[], env: Env) {
  const client = await env.client

  fs.rmSync(env.schemaDir, { recursive: true, force: true })
  fs.mkdirSync(env.schemaDir, { recursive: true })

  const { pre: prePlanFiles, rest: schemaFiles } = group(filePaths, file => {
    const name = path.basename(file)
    return name[0] === '!' ? 'pre' : 'rest'
  })

  const fixedFuncs: SQLFunc[] = []
  const declaredTypes: SQLObject[] = []

  if (schemaFiles) {
    for (const file of schemaFiles) {
      const symlinkPath = path.join(
        env.schemaDir,
        path.basename(file, path.extname(file)) +
          '.' +
          md5Hash(file).slice(0, 8) +
          '.sql',
      )

      const stmts = splitStatements(fs.readFileSync(file, 'utf8'))

      for (let i = 0; i < stmts.length; i++) {
        let stmt = stmts[i]

        if (/CREATE\s+FUNCTION/.test(stmt)) {
          // Currently, set-returning functions lead to migration issues (caused
          // by non-existent tables). To avoid this, replace the `SETOF`
          // expression with a placeholder `TABLE` expression. This is temporary
          // and the function will be replaced after the migration, which is why
          // we're collecting the file paths and SQL in this array.
          stmt = await replace(
            stmt,
            /CREATE\s+FUNCTION\s+([^(]+?)\s*\(([\S\s]+?)\)\s+RETURNS\s+SETOF\s+(.+?)\s+AS\b/gi,
            async (_, name, signature, rowType) => {
              const rowTypeName = parseIdentifier(rowType)
              const rowTypeExists = await client.scalar<boolean>(
                sql`
                  SELECT EXISTS (
                    SELECT 1
                    FROM pg_type t
                    WHERE 
                      t.typname = ${sql.val(rowTypeName.name)}
                      AND t.typnamespace = ${sql.val(rowTypeName.schema ?? 'public')}::regnamespace
                  );
                `,
              )
              console.log('rowType %O exists? %O', rowType, rowTypeExists)
              if (!rowTypeExists) {
                fixedFuncs.push({ name, stmt, signature })
                return `CREATE FUNCTION ${name} (${signature}) RETURNS TABLE(_ int) AS`
              }
              return ''
            },
          )
        } else {
          // Non-enum types are not supported by pg-schema-diff, so move them into
          // the pre-apply file.
          const typeMatch = /\bCREATE\s+TYPE\s+(.+?)\s+AS(\s+ENUM)?\b/i.exec(
            stmt,
          )
          if (typeMatch) {
            const [_, name, isEnum] = typeMatch
            if (!isEnum) {
              console.log('type %O', { name, stmt })
              declaredTypes.push({ name, stmt })
              stmt = ''
            }
          }
        }

        stmts[i] = stmt
      }

      try {
        fs.unlinkSync(symlinkPath)
      } catch {}
      fs.writeFileSync(symlinkPath, sift(stmts).join('\n\n'))
    }
  }

  let prePlanDDL = dedent`
    SET check_function_bodies = off;
  `

  if (prePlanFiles) {
    prePlanDDL +=
      '\n\n' +
      prePlanFiles.map(file => fs.readFileSync(file, 'utf8')).join('\n\n')
  }

  let preApplyDDL = ''

  const changedTypes: SQLObject[] = []
  if (declaredTypes.length) {
    await client.query(sql`CREATE SCHEMA IF NOT EXISTS nano;`)
    await Promise.all(
      declaredTypes.map(async type => {
        if (await hasTypeChanged(client, type)) {
          log('type %s has changed', type.name)
          changedTypes.push(type)
        }
      }),
    )

    if (changedTypes.length) {
      preApplyDDL += '\n\n' + changedTypes.map(type => type.stmt).join('\n\n')
    }
  }

  const prePlanFile = path.join(env.untrackedDir, 'pre-plan.sql')
  fs.writeFileSync(prePlanFile, prePlanDDL)

  const preApplyFile = path.join(env.untrackedDir, 'pre-apply.sql')
  fs.writeFileSync(preApplyFile, preApplyDDL)

  await Promise.all([
    ...fixedFuncs.map(func => {
      return client.query(
        sql.unsafe(`DROP FUNCTION IF EXISTS ${func.name} (${func.signature});`),
      )
    }),
    ...changedTypes.map(type =>
      client.query(sql.unsafe(`DROP TYPE IF EXISTS ${type.name} CASCADE;`)),
    ),
  ])

  return async () => {
    for (const { stmt } of fixedFuncs) {
      await client.query(
        sql.unsafe(
          stmt.replace(
            /CREATE\s+FUNCTION\s+([^;]+?)\s+RETURNS\s+SETOF\s+/gi,
            (match, signature) => {
              return `DROP FUNCTION ${signature}; ${match}`
            },
          ),
        ),
      )
    }
  }
}

function md5Hash(input: string): string {
  return crypto.createHash('md5').update(input).digest('hex')
}

/**
 * Compare a type to the existing type in the database.
 *
 * @returns `true` if the type has changed, `false` otherwise.
 */
async function hasTypeChanged(client: Client, type: SQLObject) {
  const typeName = parseIdentifier(type.name)
  const typeStmt = typeName.schema
    ? type.stmt.replace(typeName.schema, 'nano')
    : type.stmt.replace(typeName.name, 'nano.' + typeName.name)

  // Add the current type to the database (but under the "nano" schema),
  // so we can compare it to the existing type.
  await client.query(
    sql`DROP TYPE IF EXISTS nano.${sql.unsafe(typeName.name)} CASCADE; ${sql.unsafe(typeStmt)}`,
  )

  const selectTypeByName = (name: string, schema: string) => sql`
    SELECT
      a.attname AS column_name,
      a.atttypid AS type_id,
      a.attnum AS column_number
    FROM
      pg_attribute a
    JOIN
      pg_type t ON t.oid = a.attrelid
    WHERE
      t.typname = ${sql.val(unquote(name))}
      AND t.typnamespace = ${sql.val(unquote(schema))}::regnamespace
    ORDER BY
      a.attnum
  `

  const hasChanges = await client.scalar<boolean>(
    sql`
      WITH type1 AS (
        ${selectTypeByName(typeName.name, typeName.schema ?? 'public')}
      ),
      type2 AS (
        ${selectTypeByName(typeName.name, 'nano')}
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

  // Clean up the temporary type.
  await client.query(
    sql`DROP TYPE IF EXISTS nano.${sql.unsafe(typeName.name)} CASCADE;`,
  )

  return hasChanges
}

// async function hasFunctionChanged(client: Client, func: SQLFile) {
//   const funcName = parseIdentifier(func.stmts)

//   const hasChanges = await client.scalar<boolean>(
//     sql`
//       WITH function1 AS (
//         SELECT
//           p.proname AS function_name,
//           p.proargtypes::oid[] AS argument_types,
//           p.prorettype AS return_type,
//           p.prosrc AS function_body,
//           p.probin AS internal_body,
//           p.provariadic AS variadic_type,
//           p.proisagg AS is_aggregate,
//           p.prokind AS function_kind
//         FROM
//           pg_proc p
//         JOIN
//           pg_namespace n ON p.pronamespace = n.oid
//         WHERE
//           p.proname = ${sql.val(typeName.identifier)}
//           AND n.nspname = ${sql.val(typeName.namespace ?? 'public')}
//       ),
//       function2 AS (
//         SELECT
//           p.proname AS function_name,
//           p.proargtypes::oid[] AS argument_types,
//           p.prorettype AS return_type,
//           p.prosrc AS function_body,
//           p.probin AS internal_body,
//           p.provariadic AS variadic_type,
//           p.proisagg AS is_aggregate,
//           p.prokind AS function_kind
//         FROM
//           pg_proc p
//         JOIN
//           pg_namespace n ON p.pronamespace = n.oid
//         WHERE
//           p.proname = 'my_function'
//           AND n.nspname = 'schema2'
//       )
//       SELECT
//         f1.function_name = f2.function_name AND
//         f1.argument_types = f2.argument_types AND
//         f1.return_type = f2.return_type AND
//         COALESCE(f1.function_body, '') = COALESCE(f2.function_body, '') AND
//         COALESCE(f1.internal_body, '') = COALESCE(f2.internal_body, '') AND
//         f1.variadic_type = f2.variadic_type AND
//         f1.is_aggregate = f2.is_aggregate AND
//         f1.function_kind = f2.function_kind AS functions_are_equal
//       FROM
//         function1 f1,
//         function2 f2;
//     `,
//   )

//   return hasChanges
// }

/**
 * Split a string of SQL statements into individual statements. This assumes
 * your SQL is properly indented.
 */
function splitStatements(stmts: string): string[] {
  const regex = /;\s*\n(?=\S)/g
  const statements = stmts.split(regex)
  return statements.map(stmt => stmt.trim() + ';')
}

async function replace(
  input: string,
  regex: RegExp,
  replacer: (match: string, ...args: any[]) => string | Promise<string>,
) {
  let str = ''
  let index = 0

  let match: RegExpExecArray | null
  while ((match = regex.exec(input))) {
    const replacement = await replacer(
      ...(match as unknown as Parameters<typeof replacer>),
    )

    str += input.slice(index, match.index) + replacement
    index = match.index + match[0].length

    if (!regex.global) {
      break
    }
  }

  return str + input.slice(index)
}

// Remove surrounding double quotes if present.
function unquote(str: string) {
  if (str.startsWith('"') && str.endsWith('"')) {
    return str.slice(1, -1)
  }
  return str
}
