import type { sql, SQLTemplate } from 'pg-native'
import type { PgNamespace } from '../cli/introspect'
import type { ParsedObjectStmt } from '../cli/parseObjectStatements.js'
import type { PgTypeMapping } from '../cli/typeConversion'

type Awaitable<T> = T | Promise<T>

export interface Plugin {
  name: string
  /**
   * Optionally return a SQL template containing `CREATE` statements. Other
   * commands will be ignored.
   */
  statements?: (ctx: StatementsContext) => Awaitable<SQLTemplate | null>
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

export interface StatementsContext {
  objects: readonly Readonly<ParsedObjectStmt>[]
  /**
   * Use this to create SQL templates.
   */
  sql: typeof sql
}

export interface GenerateContext {
  types: readonly PgTypeMapping[]
  namespaces: Record<string, PgNamespace>
}

export interface TypeAlias {
  name: string
  type: string
}

export type * from '@pg-nano/pg-parser'
export { SQLIdentifier } from '../cli/identifier.js'
export type * from '../cli/parseObjectStatements.js'
