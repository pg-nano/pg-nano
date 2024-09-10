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
  /**
   * Iterate over all types used in the generated code and replace them with the
   * result of the given iterator.
   *
   * By returning a string from your iterator, you can replace the type with a
   * custom type alias, which you must define using the
   * `GenerateContext#prepend` method.
   */
  replaceTypes: (
    iterator: (type: PgTypeMapping) => string | PgTypeMapping,
  ) => void
  /**
   * Prepend code to the generated TypeScript file, right after the imports.
   */
  prepend: (code: string) => void
  /**
   * Import a namespace (using `import * as` syntax).
   */
  addNamespaceImport: (from: string, as: string) => void
  /**
   * Import types from another package (using `import type` syntax).
   *
   * Any name in the `names` array may define a local alias with the
   * `"imported:alias"` name format.
   */
  addTypeImports: (from: string, names: string[]) => void
  /**
   * Import values from another package (using `import` syntax).
   *
   * Any name in the `names` array may define a local alias with the
   * `"imported:alias"` name format.
   */
  addImports: (from: string, names: string[]) => void
}

export interface TypeAlias {
  name: string
  type: string
}

export type * from '@pg-nano/pg-parser'
export { SQLIdentifier } from '../cli/identifier.js'
export type * from '../cli/parseObjectStatements.js'
