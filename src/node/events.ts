import type { ColumnDef, InsertStmt, Node } from '@pg-nano/pg-parser'
import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import util from 'node:util'
import { stringifyConnectOptions, type ConnectOptions } from 'pg-native'
import { capitalize, counting } from 'radashi'
import type { Plugin } from './config/plugin.js'
import { debug, traceMutations } from './debug.js'
import { log } from './log.js'
import type { PgInsertStmt, PgObjectStmt } from './parser/types.js'

type EventMap = {
  connecting: [options: ConnectOptions]
  'create-database': [dbname: string]
  'load-config': [event: { configFilePath: string }]
  'unsupported-type': [event: { typeOid: number; typeName: string }]
  'create-object': [event: { object: PgObjectStmt }]
  'update-object': [event: { object: PgObjectStmt }]
  'name-collision': [event: { object: PgObjectStmt }]
  'prepare:start': []
  'mutation:apply': [event: { query: string }]
  'prepare:skip-insert': [event: { insert: PgInsertStmt }]
  'plugin:statements': [event: { plugin: Plugin }]
  'parser:found': [
    event: { objectStmts: PgObjectStmt[]; insertStmts: PgInsertStmt[] },
  ]
  'parser:skip-column': [event: { columnDef: ColumnDef }]
  'parser:unhandled-statement': [event: { query: string; node: Node }]
  'parser:unhandled-insert': [event: { insertStmt: InsertStmt }]
  'migrate:plan': []
  'migrate:start': []
  'migrate:static-rows:start': []
  'migrate:static-rows:end': [
    event: { insertedRowCount: number; deletedRowCount: number },
  ]
  'generate:start': []
  'generate:end': []
  'pg-schema-diff:apply': [event: { proc: ChildProcess }]
}

export const events = new EventEmitter<EventMap>()

export function enableEventLogging(verbose?: boolean) {
  events.on('connecting', options => {
    if (options.password) {
      options = { ...options, password: '***' }
    }
    log('Connecting to database', stringifyConnectOptions(options))
  })

  events.on('create-database', dbname => {
    log('Database "%s" not found, creating...', dbname)
  })

  events.on('load-config', ({ configFilePath }) => {
    log('Loading config file', configFilePath)
  })

  events.on('unsupported-type', event => {
    log.warn(`Unsupported type: ${event.typeName} (${event.typeOid})`)
  })

  events.on('create-object', ({ object }) => {
    log.magenta('Creating %s %s', object.kind, object.id.toQualifiedName())
  })

  events.on('update-object', ({ object }) => {
    log.magenta('Updating %s %s', object.kind, object.id.toQualifiedName())
  })

  let done: () => void

  events.on('prepare:start', () => {
    done = log.task('Preparing for migration...')
  })

  events.on('mutation:apply', ({ query }) => {
    traceMutations('Applying mutation', query)
  })

  events.on('prepare:skip-insert', ({ insert }) => {
    log.warn(
      'Skipping insert into %s (%s:%s)',
      insert.relationId.toQualifiedName(),
      insert.file,
      insert.line,
    )
  })

  events.on('name-collision', ({ object }) => {
    log.warn(
      '%s name is already in use:',
      capitalize(object.kind),
      object.id.toQualifiedName(),
    )
  })

  events.on('plugin:statements', ({ plugin }) => {
    log('Generating SQL statements with plugin', plugin.name)
  })

  const pluralize = (noun: string, count: number) =>
    `${noun}${count > 1 ? 's' : ''}`

  events.on('parser:found', ({ objectStmts, insertStmts }) => {
    const found: string[] = []
    for (const [kind, count] of Object.entries(
      counting(objectStmts, stmt => stmt.kind),
    )) {
      found.push(count + ' ' + pluralize(kind, count))
    }
    const insertCount = insertStmts.reduce(
      (sum, insert) => sum + insert.tuples.length,
      0,
    )
    if (insertCount > 0) {
      found.push(insertCount + ' ' + pluralize('insert', insertCount))
    }
    log(
      `Found ${found.slice(0, -1).join(', ')}${found.length > 2 ? ',' : ''} and ${found.at(-1)}`,
    )
  })

  const inspect = (value: any) =>
    util.inspect(value, { depth: null, colors: true })

  const dump = (value: any) => debug.enabled && debug(inspect(value))

  events.on('parser:skip-column', ({ columnDef }) => {
    log.warn(
      'Skipping column with missing %s',
      columnDef.colname ? 'type' : 'name',
    )
    dump(columnDef)
  })

  events.on('parser:unhandled-statement', ({ query, node }) => {
    const cleanedStmt = query
      .replace(/(^|\n) *--[^\n]+/g, '')
      .replace(/\s+/g, ' ')

    log.warn('Unhandled statement:')
    log.warn(
      '  ' +
        (cleanedStmt.length > 50
          ? cleanedStmt.slice(0, 50) + '…'
          : cleanedStmt),
    )
    dump(node)
  })

  events.on('parser:unhandled-insert', ({ insertStmt }) => {
    log.warn('Unhandled INSERT statement:')
    dump(insertStmt)
  })

  events.on('migrate:plan', () => {
    done()
    done = log.task('Planning migration...')
  })

  events.on('migrate:start', () => {
    done()
    done = log.task('Migrating database...')
  })

  events.on('migrate:static-rows:start', () => {
    done()
    done = log.task('Migrating static rows...')
  })

  events.on(
    'migrate:static-rows:end',
    ({ insertedRowCount, deletedRowCount }) => {
      done()
      if (insertedRowCount > 0) {
        log(
          'Inserted %d row%s',
          insertedRowCount,
          insertedRowCount > 1 ? 's' : '',
        )
      }
      if (deletedRowCount > 0) {
        log('Deleted %d row%s', deletedRowCount, deletedRowCount > 1 ? 's' : '')
      }
    },
  )

  events.on('generate:start', () => {
    done = log.task('Generating type definitions...')
  })

  events.on('generate:end', () => {
    done()
  })
}
