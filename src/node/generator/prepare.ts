import fs from 'node:fs'
import path from 'node:path'
import { PgResultError, sql } from 'pg-nano'
import { map, memo, sift } from 'radashi'
import type { Plugin } from '../config/plugin.js'
import { debug, traceChecks, traceDepends, traceParser } from '../debug.js'
import type { Env } from '../env.js'
import { events } from '../events.js'
import {
  findAddedTableColumns,
  hasCompositeTypeChanged,
  hasRoutineSignatureChanged,
} from '../inspector/diff.js'
import type { PgBaseType } from '../inspector/types.js'
import { linkObjectStatements } from '../linker/link.js'
import type { SQLIdentifier } from '../parser/identifier.js'
import { parseObjectStatements } from '../parser/parse.js'
import type { PgObjectStmt, PgObjectStmtKind } from '../parser/types.js'
import { cwdRelative } from '../util/path.js'

export async function prepareDatabase(
  sqlFiles: string[],
  baseTypes: PgBaseType[],
  env: Env,
) {
  const pg = await env.client

  traceParser('parsing SQL files')

  const parsedFiles = await map(sqlFiles, async file => {
    const content = fs.readFileSync(file, 'utf8')
    traceParser('parsing SQL file:', file)
    const objects = await parseObjectStatements(content, file, baseTypes)
    return { file, objects }
  })

  type ObjectExistenceConfig = {
    from: string
    schemaKey: string
    nameKey: string
  }

  /**
   * If an object can be referenced by other objects and pg-schema-diff doesn't
   * yet infer the dependency for its topological sorting, it needs to be added
   * to this registry so its existence can be checked.
   *
   * Currently, functions and composite types need their dependencies created
   * before the pg-schema-diff migration process begins.
   */
  const objectExistence: Record<PgObjectStmtKind, ObjectExistenceConfig> = {
    routine: {
      from: 'pg_proc',
      schemaKey: 'pronamespace',
      nameKey: 'proname',
    },
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
    view: {
      from: 'pg_views',
      schemaKey: 'schemaname',
      nameKey: 'viewname',
    },
    extension: {
      from: 'pg_extension',
      schemaKey: 'extnamespace',
      nameKey: 'extname',
    },
  }

  const doesObjectExist = memo((type: PgObjectStmtKind, id: SQLIdentifier) => {
    if (!(type in objectExistence)) {
      return false
    }

    if (traceChecks.enabled) {
      traceChecks('does %s exist?', id.toQualifiedName())
    }

    const { from, schemaKey, nameKey } = objectExistence[type]

    return pg.queryValue<boolean>(sql`
      SELECT EXISTS (
        SELECT 1
        FROM ${sql.id(from)}
        WHERE ${sql.id(schemaKey)} = ${id.schemaVal}${schemaKey.endsWith('namespace') ? sql.unsafe('::regnamespace') : ''}
          AND ${sql.id(nameKey)} = ${id.nameVal}
      );
    `)
  })

  const allObjects = parsedFiles.flatMap(parsedFile => parsedFile.objects)

  // Plugins may add to the object list, so run them before linking the object
  // dependencies together.
  const pluginsByStatementId = await preparePluginStatements(
    env,
    baseTypes,
    allObjects,
  )

  debug('plugin statements prepared')

  // Since pg-schema-diff is still somewhat limited, we have to create our own
  // dependency graph, so we can ensure all objects (and their dependencies)
  // exist before pg-schema-diff works its magic.
  const sortedObjects = linkObjectStatements(allObjects)

  // The "nano" schema is used to store temporary objects during diffing.
  await pg.query(sql`
    DROP SCHEMA IF EXISTS nano CASCADE;
    CREATE SCHEMA nano;
  `)

  if (traceDepends.enabled) {
    for (const object of sortedObjects) {
      if (object.dependencies.size > 0) {
        traceDepends(
          '%s %s depends on %s',
          object.kind,
          object.id.toQualifiedName(),
          Array.from(object.dependencies)
            .map(dep => dep.id.toQualifiedName())
            .join(', '),
        )
      } else {
        traceDepends(
          '%s %s has no dependencies',
          object.kind,
          object.id.toQualifiedName(),
        )
      }
    }
  }

  const objectUpdates = new Map(
    allObjects.map(object => [object, Promise.withResolvers<any>()] as const),
  )

  async function updateObject(object: PgObjectStmt): Promise<any> {
    if (!(object.kind in objectExistence)) {
      events.emit('unsupported-object', { object })
      return
    }

    const exists = await doesObjectExist(object.kind, object.id)

    // Wait for dependencies to be created/updated before proceeding.
    if (object.dependencies.size > 0) {
      await Promise.all(
        Array.from(object.dependencies).map(
          dependency => objectUpdates.get(dependency)?.promise,
        ),
      )
    }

    if (!exists) {
      events.emit('create-object', { object })
      return pg.query(sql.unsafe(object.query))
    }

    if (object.kind === 'type') {
      if (object.subkind === 'composite') {
        if (await hasCompositeTypeChanged(pg, object)) {
          events.emit('update-object', { object })
          return pg.query(sql`
            DROP TYPE ${object.id.toSQL()} CASCADE;
            ${sql.unsafe(object.query)}
          `)
        }
      }
    } else if (object.kind === 'routine') {
      if (await hasRoutineSignatureChanged(pg, object)) {
        events.emit('update-object', { object })
        return pg.query(sql`
          DROP ROUTINE ${object.id.toSQL()} CASCADE;
          ${sql.unsafe(object.query)}
        `)
      }
    } else if (object.kind === 'table') {
      const addedColumns = await findAddedTableColumns(pg, object)

      if (addedColumns.length > 0) {
        events.emit('update-object', { object })

        const alterStmts = addedColumns.map(name => {
          const index = object.columns.findIndex(c => c.name === name)
          const column = object.columns[index]

          const siblingIndex = index + 1
          const siblingNode =
            siblingIndex < object.columns.length
              ? object.columns[siblingIndex].node
              : undefined

          const colExpr = object.query.slice(
            column.node.location,
            siblingNode?.location ?? object.query.lastIndexOf(')'),
          )

          return sql`
            ALTER TABLE ${object.id.toSQL()} ADD COLUMN ${sql.unsafe(colExpr)};
          `
        })

        return pg.query(sql`${sql.join('\n', alterStmts)}`)
      }
    }
  }

  await Promise.all(
    allObjects.map(object => {
      const { resolve } = objectUpdates.get(object)!
      return updateObject(object).then(resolve, async error => {
        const exists = await doesObjectExist(object.kind, object.id)
        throwFormattedQueryError(error, object, exists)
      })
    }),
  )

  // Drop the "nano" schema now that diffing is complete.
  await pg.query(sql`
    DROP SCHEMA IF EXISTS nano CASCADE;
  `)

  fs.rmSync(env.schemaDir, { recursive: true, force: true })
  fs.mkdirSync(env.schemaDir, { recursive: true })

  const indexWidth = String(sortedObjects.size).length

  let objectIndex = 1
  for (const object of sortedObjects) {
    const name = sift([
      String(objectIndex++).padStart(indexWidth, '0'),
      object.kind === 'extension' ? object.kind : null,
      object.id.schema,
      object.id.name,
    ])

    const outFile = path.join(env.schemaDir, name.join('-') + '.sql')
    fs.writeFileSync(
      outFile,
      '-- file://' +
        object.file +
        '#L' +
        object.line +
        '\n' +
        object.query +
        ';\n',
    )
  }

  return [allObjects, pluginsByStatementId] as const
}

function getLineFromPosition(position: number, query: string) {
  let line = 1
  for (let i = 0; i < position; i++) {
    if (query[i] === '\n') {
      line++
    }
  }
  return line
}

async function preparePluginStatements(
  env: Env,
  baseTypes: PgBaseType[],
  allObjects: PgObjectStmt[],
) {
  // Ensure that removed plugins don't leave behind any SQL files.
  fs.rmSync(env.config.generate.pluginSqlDir, {
    recursive: true,
    force: true,
  })

  type StatementsPlugin = Plugin & { statements: Function }

  const plugins = env.config.plugins.filter(
    (p): p is StatementsPlugin => p.statements != null,
  )

  const pluginsByStatementId = new Map<string, StatementsPlugin>()

  if (plugins.length === 0) {
    return pluginsByStatementId
  }

  fs.mkdirSync(env.config.generate.pluginSqlDir, { recursive: true })

  for (const plugin of plugins) {
    events.emit('plugin:statements', { plugin })

    const template = await plugin.statements(
      { objects: allObjects },
      env.config,
    )

    if (template) {
      const outFile = path.join(
        env.config.generate.pluginSqlDir,
        plugin.name.replace(/\//g, '__') + '.pgsql',
      )

      const pg = await env.client
      const content = pg.stringify(template, {
        reindent: true,
      })

      // Write to disk so the developer can see the generated SQL, and possibly
      // commit it to source control (if desired). Note that this won't trigger
      // the file watcher, since the pluginSqlDir is ignored.
      fs.writeFileSync(outFile, content)

      // Immediately parse the generated statements so they can be used by
      // plugins that run after this one.
      const objects = await parseObjectStatements(content, outFile, baseTypes)
      for (const object of objects) {
        if (allObjects.some(other => other.id.equals(object.id))) {
          events.emit('name-collision', { object })
          continue
        }
        allObjects.push(object)
        pluginsByStatementId.set(object.id.toQualifiedName(), plugin)
      }
    }
  }

  return pluginsByStatementId
}

function throwFormattedQueryError(
  error: Error,
  object: PgObjectStmt,
  exists: boolean,
): never {
  let message = error.message.replace(/^ERROR:\s+/i, '').trimEnd()

  // Remove "LINE XXX: " if present, and the same number of characters from
  // any lines that come after.
  const messageLines = message.split('\n')
  for (let i = 0; i < messageLines.length; i++) {
    if (messageLines[i].startsWith('LINE ')) {
      const colonIndex = messageLines[i].indexOf(':') + 2
      messageLines[i] =
        ' '.repeat(colonIndex) + messageLines[i].slice(colonIndex)
      message = messageLines.join('\n')
      break
    }
  }

  const id = object.id.toQualifiedName()
  if (!message.includes(id)) {
    message = `Error ${exists ? 'updating' : 'creating'} ${object.kind} (${id}): ${message}`
  }

  const line =
    error instanceof PgResultError && error.statementPosition
      ? object.line -
        1 +
        getLineFromPosition(
          Number.parseInt(error.statementPosition),
          object.query,
        )
      : object.line

  const stack =
    '\n    at ' +
    cwdRelative(object.file) +
    ':' +
    line +
    (error.stack
      ?.replace(error.name + ': ' + error.message, '')
      .replace(/^\s*(?=\n)/, '') ?? '')

  error.message = message
  error.stack = message + stack
  throw error
}
