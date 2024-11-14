import os from 'node:os'
import path from 'node:path'
import { parseConnectionString, stringifyConnectOptions } from 'pg-native'
import { noop, pascal } from 'radashi'
import type { ConnectOptions, FunctionType, UserConfig } from './configTypes'
import type { PgRoutineBindingFunction } from './plugin.js'

export type ResolvedConfig = ReturnType<typeof resolveConfig>

interface Options {
  dsn?: string
}

export function resolveConfig(
  root: string,
  userConfig: UserConfig | undefined,
  options: Options,
) {
  let connection: ConnectOptions

  const connectionString = options.dsn || userConfig?.dev.connectionString
  if (connectionString) {
    if (!options.dsn && userConfig?.dev.connection) {
      throw new Error(
        'Cannot set both dev.connection and dev.connectionString. ' +
          'Use one or the other.',
      )
    }
    connection = parseConnectionString(connectionString)
  } else if (userConfig?.dev.connection) {
    connection = userConfig.dev.connection
  } else {
    throw Error(
      'Must set either dev.connectionString or dev.connection ' +
        'in your config file or specify the --dsn flag',
    )
  }

  return {
    ...userConfig,
    plugins: userConfig?.plugins ?? [],
    dev: {
      ...userConfig?.dev,
      connectionString: stringifyConnectOptions({
        application_name: 'pg-nano',
        ...connection,
      }),
      connection: {
        ...connection,
        // Ensure host and dbname always exist.
        host: connection.host || 'localhost',
        dbname:
          connection.dbname || process.env.PGDATABASE || os.userInfo().username,
      },
    },
    schema: {
      ...userConfig?.schema,
      include: userConfig?.schema?.include ?? ['**/*.pgsql'],
      exclude: userConfig?.schema?.exclude ?? ['**/node_modules'],
    },
    migration: {
      ...userConfig?.migration,
      allowHazards: userConfig?.migration?.allowHazards ?? [],
    },
    generate: {
      ...userConfig?.generate,
      outFile: path.resolve(
        root,
        userConfig?.generate?.outFile ?? 'sql/schema.ts',
      ),
      fieldCase: userConfig?.generate?.fieldCase ?? 'camel',
      pluginSqlDir: path.resolve(
        root,
        userConfig?.generate?.pluginSqlDir ?? 'sql/nano_plugins',
      ),
      functionPatterns: compileFunctionPatterns(
        userConfig?.generate?.functionPatterns ?? {},
      ),
    },
  }
}

function compileFunctionPatterns(typesByPattern: Record<string, FunctionType>) {
  const matchers = Object.keys(typesByPattern).map(pattern => {
    let flags: string | undefined
    if (pattern[0] === '/') {
      const regexEnd = pattern.lastIndexOf('/')
      if (regexEnd === 0) {
        throw new Error(`Invalid function pattern: ${pattern}`)
      }
      pattern = pattern.slice(1, regexEnd)
      flags = pattern.slice(regexEnd + 1)
    }
    return new RegExp(pattern, flags)
  })
  if (matchers.length === 0) {
    return noop
  }
  const types = Object.values(typesByPattern)
  const validTypes = [
    'value',
    'value?',
    'row',
    'row?',
    'value-list',
    'row-list',
  ]
  types.forEach((type, index) => {
    if (!validTypes.includes(type)) {
      throw new Error(
        `Function pattern ${matchers[index]} has invalid type: ${type}`,
      )
    }
  })
  return (name: string) => {
    const index = matchers.findIndex(matcher => matcher.test(name))
    if (index >= 0) {
      const type = types[index]
      return `bindQuery${pascal(type.replace('?', 'OrNull'))}` as PgRoutineBindingFunction
    }
  }
}
