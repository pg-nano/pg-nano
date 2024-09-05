import type { sql, SQLTemplate } from 'pg-native'
import type { PgNamespace } from '../cli/introspect'
import type { PgTypeMapping } from '../cli/typeConversion'
import type { Client } from '../client'

type Awaitable<T> = T | Promise<T>

export interface Plugin {
  name: string
  /**
   * Return a SQL template to be executed or null to skip.
   *
   * Note that pg-schema-diff will handle migrations, so you can use `CREATE`
   * commands without worrying about conflicts.
   *
   * **Important:** This method must have a deterministic output, or you will
   * trigger an infinite loop of migrations.
   */
  queries?: (ctx: QueriesContext) => Awaitable<SQLTemplate | null>
  /**
   * This hook runs during the TypeScript generation phase. Your plugin can use
   * the given context to improve type safety by modifying a `PgFunction` object
   * before it's used to generate the TypeScript.
   *
   * This is most useful when your plugin has generated a Postgres function (via
   * the `queries` hook) that depends on polymorphic parameters (like a `JSON`
   * type). Now you can use the `generate` hook to modify the generated
   * TypeScript to better suit the loosely-typed Postgres function.
   */
  generate?: (ctx: GenerateContext) => Awaitable<void>
}

export interface QueriesContext {
  /**
   * This client is connected as a readonly user. Therefore, you should use it
   * for read-only queries.
   */
  client: Client
  /**
   * Use this to create SQL templates.
   */
  sql: typeof sql
}

export interface GenerateContext {
  types: readonly PgTypeMapping[]
  namespaces: Record<string, PgNamespace>
}
