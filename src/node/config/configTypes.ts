import type { ConnectOptions } from 'pg-native'
import type { MigrationHazardType } from './hazards'
import type { Plugin } from './plugin'

export type { ConnectOptions, MigrationHazardType }

export type FieldCase = 'camel' | 'preserve'

export interface UserConfig {
  dev: {
    /**
     * The connection string to use when connecting to the database. The user
     * must be a superuser.
     *
     * This may be a DSN (e.g. `"postgres://user:pass@host:port/db"`) or a
     * string of space-separated connection options (e.g. `"user=postgres
     * password=pass host=localhost port=5432 dbname=db"`).
     *
     * You may prefer using the `connection` option instead, which allows you to
     * set all the connection options individually.
     */
    connectionString?: string
    /**
     * The connection options to use when connecting to the database. The user
     * must be a superuser. This option is required if `connectionString` is not
     * provided, but you can set it to an `{}` to use only
     * {@link https://www.postgresql.org/docs/current/libpq-envars.html|environment variables}
     * like `PGUSER`, `PGPASSWORD`, etc.
     */
    connection?: ConnectOptions
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
    /**
     * Allow certain migration hazards that are usually disabled for safety. By
     * default, when connecting to a local Postgres instance, all hazards are
     * allowed.
     */
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
    fieldCase?: FieldCase
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
    /**
     * Run a script after the TypeScript definitions have been generated. This
     * can be useful for formatting the generated code after it's been written
     * to disk.
     */
    postGenerateScript?: string
  }
  plugins?: Plugin[]
}