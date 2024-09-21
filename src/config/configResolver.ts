import path from 'node:path'
import type { UserConfig } from 'pg-nano/config'
import { stringifyConnectOptions } from 'pg-native'

export type ResolvedConfig = ReturnType<typeof resolveConfig>

interface Options {
  dsn?: string
}

export function resolveConfig(
  root: string,
  userConfig: UserConfig | undefined,
  options: Options,
) {
  let connectionString = options.dsn ?? userConfig?.dev.connectionString
  if (connectionString) {
    connectionString = addApplicationName(connectionString)
  } else if (userConfig?.dev.connection) {
    connectionString = stringifyConnectOptions({
      ...userConfig.dev.connection,
      application_name: 'pg-nano',
    })
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
      connectionString,
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

function addApplicationName(connectionString: string) {
  const name = 'pg-nano'
  if (/^\w+:\/\//.test(connectionString)) {
    const url = new URL(connectionString)
    url.searchParams.set('application_name', name)
    return url.toString()
  }
  const options = Object.fromEntries(
    connectionString.split(' ').map(part => {
      const [key, value] = part.split('=')
      return [key, value] as const
    }),
  )
  options.application_name = name
  return stringifyConnectOptions(options as any)
}
