import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { QueryType, sql, type Connection, type TextParser } from 'pg-native'
import { pascal } from 'radashi'
import { debug } from '../debug.js'

export async function importCustomTypeParsers(
  conn: Connection,
  host: string,
  port: string | number,
  dbname: string,
): Promise<{ default: Record<number, TextParser> }> {
  // Runtime-generated modules are stored in the user's home directory, so that
  // pg-nano's "dev" command can purge them when the schema changes.
  const cacheDir = path.join(os.homedir(), `.pg-nano/${host}+${port}+${dbname}`)

  const cachedModulePath = path.join(cacheDir, 'customTypeParsers.mjs')
  if (fs.existsSync(cachedModulePath)) {
    return import(cachedModulePath)
  }

  debug('building custom type parsers')

  const code = await buildCustomTypeParsers(conn)

  fs.mkdirSync(cacheDir, { recursive: true })
  fs.writeFileSync(cachedModulePath, code)

  return import(cachedModulePath)
}

async function buildCustomTypeParsers(conn: Connection) {
  let code = ''
  let textParsersByOid = ''

  const imports = new Set<string>()

  for (const type of await queryCustomTypes(conn)) {
    const parserId = `parse${pascal(type.name)}`

    if (type.kind === 'c') {
      code += `const ${parserId} = parseComposite({ ${type.attributes
        .map(attr => `${JSON.stringify(attr.name)}: ${attr.dataTypeID}`)
        .join(', ')} })\n`

      imports.add('parseComposite')
      textParsersByOid += `  ${type.id}: ${parserId},\n`
    } else {
      continue
    }

    if (type.arrayTypeID) {
      imports.add('parseArray')
      textParsersByOid += `  ${type.arrayTypeID}: parseArray(${parserId}),\n`
    }
  }

  code += `export default {\n${textParsersByOid}\n}\n`

  return `import { ${[...imports].join(', ')} } from 'pg-nano'\n\n` + code
}

type CustomType = {
  id: number
  name: string
  kind: string
  arrayTypeID: number
  attributes: {
    name: string
    dataTypeID: number
  }[]
}

function queryCustomTypes(conn: Connection) {
  return conn.query<CustomType[]>(
    QueryType.row,
    sql`
      SELECT
        oid AS "id",
        typname AS "name",
        typtype AS "kind",
        typarray AS "arrayTypeID",
        (SELECT
          json_agg(json_build_object(
            'name', attname,
            'dataTypeID', atttypid::int
          ) ORDER BY attnum)
          FROM pg_attribute
          WHERE attrelid = t.typrelid
            AND attnum > 0
            AND NOT attisdropped
        ) AS attributes
      FROM
        pg_type t
      WHERE
        typtype = 'c'
        AND typnamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
    `,
  )
}
