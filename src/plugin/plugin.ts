import type { sql, SQLTemplate } from 'pg-native'
import type { ResolvedConfig } from '../cli/env.js'
import type { ParsedObjectStmt } from '../cli/parseObjectStatements.js'
import type {
  PgFieldContext,
  PgNamespace,
  PgParamKind,
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
    ctx: PluginContext['statements'],
    config: Readonly<ResolvedConfig>,
  ) => Awaitable<SQLTemplate | null>
  /**
   * This hook runs before the TypeScript generation phase. In its context
   * object, you'll find every object loaded from the database using
   * introspection. Mutating objects within this hook is not recommended, but
   * may be useful in rare cases.
   */
  generateStart?: (
    ctx: PluginContext['generateStart'],
    config: Readonly<ResolvedConfig>,
  ) => Awaitable<void>
  /**
   * This hook can override is called for each field or parameter. It may return
   * a string to override the Postgres type used when generating an equivalent
   * TypeScript type. You may return a Postgres type or a TypeScript type.
   */
  mapTypeReference?: (
    ctx: PluginContext['mapTypeReference'],
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
    ctx: PluginContext['mapField'],
    config: Readonly<ResolvedConfig>,
  ) => { name: string; path: string } | null | void
}

export interface GenerateContext {
  typesByName: ReadonlyMap<string, PgType>
  typesByOid: ReadonlyMap<number, PgType>
  namespaces: Readonly<Record<string, PgNamespace>>
  routines: readonly PgRoutine[]
  tables: readonly PgTable[]
}

export interface PluginContext {
  statements: {
    /**
     * The objects parsed from the input SQL files.
     */
    objects: readonly Readonly<ParsedObjectStmt>[]
    /**
     * A tagged template literal for creating SQL templates.
     */
    sql: typeof sql
  }
  generateStart: GenerateContext
  mapTypeReference: PgTypeContext &
    GenerateContext & {
      /**
       * Render a Postgres type to its TypeScript-equivalent type syntax, which
       * is typically an identifier.
       */
      renderTypeReference: (
        oid: number,
        paramKind?: PgParamKind | null,
      ) => string
    }
  mapField: PgFieldContext & GenerateContext
}

export type * from '@pg-nano/pg-parser'
export { $, select, walk } from '@pg-nano/pg-parser'
export type { ResolvedConfig } from '../cli/env.js'
export { SQLIdentifier } from '../cli/identifier.js'
export type * from '../cli/parseObjectStatements.js'
export type * from '../cli/pgTypes.js'
export {
  isBaseType,
  isCompositeType,
  isEnumType,
  isTableType,
  PgIdentityKind,
  PgObjectType,
  PgParamKind,
  PgRoutineKind,
} from '../cli/pgTypes.js'
