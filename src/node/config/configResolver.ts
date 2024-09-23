import path from 'node:path'
import os from 'os'
import { parseConnectionString, stringifyConnectOptions } from 'pg-native'
import type { ConnectOptions, UserConfig } from './configTypes'

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
    },
  }
}
