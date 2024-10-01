import type { SQLTemplate } from 'pg-native'
import type {
  PgFieldContext,
  PgNamespace,
  PgObject,
  PgParamKind,
  PgRoutine,
  PgTable,
  PgType,
  PgTypeContext,
} from '../inspector/types.js'
import type { PgObjectStmt } from '../parser/types.js'
import type { ResolvedConfig } from './configResolver.js'

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
  generateEnd?: (
    ctx: PluginContext['generateEnd'],
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
   *
   * - `args` – An optional string of comma-separated JS expressions that will
   *   be passed into the field mapper.
   */
  mapField?: (
    ctx: PluginContext['mapField'],
    config: Readonly<ResolvedConfig>,
  ) => { name: string; path: string; args?: string } | null | void
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
    objects: readonly Readonly<PgObjectStmt>[]
  }
  generateStart: GenerateContext
  generateEnd: {
    /**
     * Identifiers imported from the `pg-nano` package. These may include a
     * leading `type` keyword (for type-only imports) or a trailing `as` clause
     * (for renaming imports).
     */
    imports: Set<string>
    /**
     * Imports from other packages that will be added to the generated
     * TypeScript module. You must include everything an `import` statement
     * needs, except for the leading `import` keyword.
     *
     * @example
     * ```ts
     * foreignImports.add('{ foo } from "bar"')
     * ```
     */
    foreignImports: Set<string>
    /**
     * A list of TypeScript statements to be included at the top of the
     * generated file, after the imports.
     */
    prelude: string[]
    /**
     * Every database object mapped to the TypeScript code generated for it.
     * After this hook is completed, they are concatenated into a single
     * TypeScript file.
     */
    renderedObjects: Map<PgObject, string>
  }
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
export { sql } from 'pg-native'
export * from '../inspector/types.js'
export type { SQLIdentifier } from '../parser/identifier.js'
export * from '../parser/types.js'
export type { ResolvedConfig } from './configResolver.js'
