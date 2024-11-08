import type { ColumnDef, Node } from '@pg-nano/pg-parser'
import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import type { Readable } from 'node:stream'
import util from 'node:util'
import { stringifyConnectOptions, type ConnectOptions } from 'pg-native'
import { capitalize } from 'radashi'
import type { Plugin } from './config/plugin.js'
import { debug } from './debug.js'
import { parseMigrationPlan } from './generator/parseMigrationPlan.js'
import { log } from './log.js'
import type { PgObjectStmt } from './parser/types.js'

type EventMap = {
  connecting: [options: ConnectOptions]
  'create-database': [dbname: string]
  'load-config': [event: { configFilePath: string }]
  'unsupported-type': [event: { typeOid: number; typeName: string }]
  'unsupported-object': [event: { object: PgObjectStmt }]
  'create-object': [event: { object: PgObjectStmt }]
  'update-object': [event: { object: PgObjectStmt }]
  'prepare:mutation': [event: { query: string }]
  'name-collision': [event: { object: PgObjectStmt }]
  'plugin:statements': [event: { plugin: Plugin }]
  'parser:skip-column': [event: { columnDef: ColumnDef }]
  'parser:unhandled-statement': [event: { query: string; node: Node }]
  'migrate:start': []
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

  events.on('unsupported-object', ({ object }) => {
    if (object.dependents.size > 0) {
      log.warn(
        'Missing %s {%s} required by %s other statement%s:',
        object.kind,
        object.id.toQualifiedName(),
        object.dependents.size,
        object.dependents.size === 1 ? 's' : '',
      )
      for (const dependent of object.dependents) {
        log.warn('  * %s {%s}', dependent.kind, dependent.id.toQualifiedName())
      }
    } else {
      log.warn(
        'Could not check if object exists: %s (%s)',
        object.id.toQualifiedName(),
        object.kind,
      )
    }
  })

  events.on('create-object', ({ object }) => {
    log.magenta('Creating %s %s', object.kind, object.id.toQualifiedName())
  })

  events.on('update-object', ({ object }) => {
    log.magenta('Updating %s %s', object.kind, object.id.toQualifiedName())
  })

  events.on('prepare:mutation', ({ query }) => {
    debug('Applying mutation', query)
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

  events.on('migrate:start', () => {
    log('Migrating database...')
  })

  events.on('generate:start', () => {
    log('Generating type definitions...')
  })

  events.on('generate:end', () => {
    if (!process.env.DEBUG) {
      log.eraseLine()
    }
    log.success('Generating type definitions... done')
  })

  if (verbose) {
    const logMigrationPlan = async (stdout: Readable) => {
      const successRegex = /(No plan generated|Finished executing)/
      const commentRegex = /^\s+-- /

      let completed = false
      for await (const line of parseMigrationPlan(stdout)) {
        if (line.type === 'title') {
          if (line.text === 'Complete') {
            completed = true
          } else {
            log(line.text)
          }
        } else if (line.type === 'body') {
          if (completed || successRegex.test(line.text)) {
            log.success(line.text)
          } else if (commentRegex.test(line.text)) {
            log.comment(line.text)
          } else {
            log.command(line.text)
          }
        }
      }
    }

    events.on('pg-schema-diff:apply', async event => {
      logMigrationPlan(event.proc.stdout!)
    })
  }
}
