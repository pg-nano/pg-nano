import os from 'node:os'
import path from 'node:path'
import { parseConnectionString, stringifyConnectOptions } from 'pg-native'
import type {
  ConnectOptions,
  FunctionPattern,
  UserConfig,
} from './configTypes.js'
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
      preferredExtension: userConfig?.generate?.preferredExtension ?? 'js',
      pluginSqlDir: path.resolve(
        root,
        userConfig?.generate?.pluginSqlDir ?? 'sql/nano_plugins',
      ),
      applyFunctionPatterns: compileFunctionPatterns(
        userConfig?.generate?.functionPatterns ?? [],
      ),
    },
  }
}

export type RoutineBindingContext = {
  name: string
  bindingFunction: PgRoutineBindingFunction
}

function compileFunctionPatterns(patterns: FunctionPattern[]) {
  if (patterns.length === 0) {
    return
  }

  const compiledPatterns = patterns.map(({ pattern }) => {
    const nameRegex = pattern.name ? compileRegExp(pattern.name) : /^/
    const bindingFunctionRegex = pattern.bindingFunction
      ? compileRegExp(pattern.bindingFunction)
      : /^/

    return {
      nameRegex,
      bindingFunctionRegex,
    }
  })

  return (context: RoutineBindingContext) => {
    for (let i = 0; i < patterns.length; i++) {
      const { nameRegex, bindingFunctionRegex } = compiledPatterns[i]
      if (
        nameRegex.test(context.name) &&
        bindingFunctionRegex.test(context.bindingFunction)
      ) {
        const overrides = patterns[i].replace
        const keys = Object.keys(overrides) as (keyof typeof overrides)[]

        for (const key of keys) {
          context[key] = overrides[key] as any
        }
      }
    }
  }
}

function compileRegExp(pattern: string) {
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
}
