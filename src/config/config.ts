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
  typescript?: {
    /**
     * The file to write the generated TypeScript definitions to. This includes
     * the UDF wrapper functions.
     *
     * @default 'sql/api.ts'
     */
    outFile?: string
  }
  plugins?: Plugin[]
}

export function defineConfig(config: UserConfig) {
  return config
}
