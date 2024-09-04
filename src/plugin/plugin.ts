import type { sql, SQLTemplate } from 'pg-native'
import type { Client } from '../client'

type Awaitable<T> = T | Promise<T>

export interface Plugin {
  name: string
  /**
   * Return a SQL template to be executed or null to skip.
   *
   * Note that pg-schema-diff will handle migrations, so you can use `CREATE`
   * commands without worrying about conflicts.
   */
  queries: (ctx: PluginContext) => Awaitable<SQLTemplate | null>
}

export interface PluginContext {
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
