import path from 'node:path'
import type { UserConfig } from 'pg-nano/config'

export type ResolvedConfig = ReturnType<typeof resolveConfig>

interface Options {
  dsn?: string
}

export function resolveConfig(
  root: string,
  userConfig: UserConfig | undefined,
  options: Options,
) {
  return {
    ...userConfig,
    plugins: userConfig?.plugins ?? [],
    dev: {
      ...userConfig?.dev,
      connectionString:
        options.dsn ??
        userConfig?.dev?.connectionString ??
        'postgres://postgres:postgres@localhost:5432/postgres',
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
