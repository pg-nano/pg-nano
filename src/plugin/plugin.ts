import type { sql, SQLTemplate } from 'pg-native'
import type { ResolvedConfig } from '../cli/env.js'
import type { ParsedObjectStmt } from '../cli/parseObjectStatements.js'
import type {
  PgFieldContext,
  PgNamespace,
  PgRoutine,
  PgTable,
  PgType,
  PgTypeContext,
} from '../cli/pgTypes.js'

type Awaitable<T> = T | Promise<T>

export interface Plugin {
  name: string
  /**
   * Optionally return a SQL template containing `CREATE` statements. Other
   * commands will be ignored.
   */
  statements?: (
    ctx: StatementsContext,
    config: Readonly<ResolvedConfig>,
  ) => Awaitable<SQLTemplate | null>
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
  generate?: (
    ctx: GenerateContext,
    config: Readonly<ResolvedConfig>,
  ) => Awaitable<void>
  /**
   * This hook can override is called for each field or parameter. It may return
   * a string to override the Postgres type used when generating an equivalent
   * TypeScript type. You may return a Postgres type or a TypeScript type.
   */
  mapTypeReference?: (
    ctx: PgTypeContext,
    config: Readonly<ResolvedConfig>,
  ) => { type: string; lang: 'psql' | 'ts' } | null | void
  /**
   * This hook can be used to apply a custom field mapper to a field. Only one
   * plugin can modify a field, and the first such plugin "wins".
   *
   * To map a field, return an object with the following properties:
   *
   * - `name` – An identifier for the field mapper. This should be globally
   *   unique and in snake_case. Avoid using JavaScript reserved words. To be
   *   safe, it's recommended to append `_mapper` to the name.
   *
   * - `path` – An import specifier pointing to your field mapper
   *   implementation, which is relative to the project root (not the plugin).
   *   It may be resolved by a bundler (e.g. esbuild, rollup, vite) or a runtime
   *   (e.g. nodejs, bun, deno). The resolved module is expected to have an
   *   export of the same `name` with its value set to a `defineFieldMapper`
   *   result.
   */
  mapField?: (
    ctx: PgFieldContext,
    config: Readonly<ResolvedConfig>,
  ) => { name: string; path: string } | null | void
}

export interface StatementsContext {
  objects: readonly Readonly<ParsedObjectStmt>[]
  /**
   * Use this to create SQL templates.
   */
  sql: typeof sql
}

export interface GenerateContext {
  types: ReadonlyMap<string, PgType>
  namespaces: Readonly<Record<string, PgNamespace>>
  functions: readonly PgRoutine[]
  tables: readonly PgTable[]
}

export type { ResolvedConfig } from '../cli/env.js'
export { SQLIdentifier } from '../cli/identifier.js'
export type * from '../cli/parseObjectStatements.js'
export type * from '../cli/pgTypes.js'
export {
  PgRoutineKind as PgFunctionKind,
  PgIdentityKind,
  PgParamKind,
  PgTypeKind,
} from '../cli/pgTypes.js'
