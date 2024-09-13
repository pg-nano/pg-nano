import type { Plugin } from '@pg-nano/plugin'
import type { MigrationHazardType } from './hazards'

export interface UserConfig {
  dev?: {
    /**
     * The connection string to use when connecting to the database.
     *
     * Defaults to `postgres://postgres:postgres@localhost:5432/postgres`.
     */
    connectionString?: string
  }
  schema?: {
    /**
     * SQL files matched by these glob patterns are loaded into the database and
     * automatically migrated when changed while the `pg-nano dev` command is
     * running.
     *
     * TypeScript definitions are generated for any `CREATE FUNCTION`
     * statements found in the matched files.
     *
     * By default, all `.pgsql` files in your project are watched.
     */
    include?: string[]
    /**
     * Files matched by these glob patterns are ignored by pg-nano.
     *
     * By default, only `node_modules` is excluded.
     */
    exclude?: string[]
  }
  migration?: {
    allowHazards?: MigrationHazardType[]
  }
  generate?: {
    /**
     * The file to write the generated TypeScript definitions to. This includes
     * the UDF wrapper functions.
     *
     * @default 'sql/api.ts'
     */
    outFile?: string
    /**
     * Fixes the casing of field names in generated types.
     *
     * - `camel` will convert snake case field names to camel case.
     * - `preserve` will leave field names as is.
     *
     * @default 'camel'
     */
    fieldCase?: 'camel' | 'preserve'
    /**
     * SQL statements generated by pg-nano plugins are written to this directory
     * so they can be added to the schema and automatically migrated.
     *
     * **Important:** You must commit this directory to your repository, or data
     * loss may occur. This is due to how plugins run *after* each migration,
     * which means the plugin-generated SQL files won't be created or  updated
     * until then.
     *
     * @default 'sql/nano_plugins'
     */
    pluginSqlDir?: string
  }
  plugins?: Plugin[]
}

export function defineConfig(config: UserConfig) {
  return config
}