import type { Field } from 'pg-native'
import type {
  ColumnDef,
  CompositeTypeStmt,
  CreateEnumStmt,
  CreateExtensionStmt,
  CreateFunctionStmt,
  CreateSchemaStmt,
  CreateStmt,
  FunctionParameter,
  ViewStmt,
} from '../config/plugin.js'
import type { SQLIdentifier } from './identifier.js'

export type PgObjectStmtKind<T = PgObjectStmt> = T extends PgObjectStmt
  ? T['kind']
  : never

export type PgObjectStmt =
  | PgRoutineStmt
  | PgTableStmt
  | PgEnumStmt
  | PgCompositeTypeStmt
  | PgViewStmt
  | PgSchemaStmt
  | PgExtensionStmt

interface IPgObjectStmt<TNode extends object> {
  kind: string
  id: SQLIdentifier
  node: TNode
  query: string
  line: number
  file: string
  dependencies: Set<PgObjectStmt>
  dependents: Set<PgObjectStmt>
}

export type PgParamDef = {
  name: string | undefined
  type: SQLIdentifier
  variadic: boolean
}

export type PgColumnDef<
  TNode extends ColumnDef | FunctionParameter = ColumnDef | FunctionParameter,
> = {
  name: string
  type: SQLIdentifier
  refs?: SQLIdentifier[]
  /**
   * This will be a `FunctionParameter` node if declared as an OUT or INOUT
   * parameter. Otherwise, it's a `ColumnDef` node.
   */
  node: TNode
}

export interface PgRoutineStmt extends IPgObjectStmt<CreateFunctionStmt> {
  kind: 'routine'
  params: PgParamDef[]
  returnType: SQLIdentifier | PgColumnDef<FunctionParameter>[] | undefined
  returnSet: boolean
  isProcedure: boolean
}

export interface PgTableStmt extends IPgObjectStmt<CreateStmt> {
  kind: 'table'
  columns: PgColumnDef<ColumnDef>[]
  primaryKeyColumns: string[]
}

export interface PgTypeStmt<TNode extends object> extends IPgObjectStmt<TNode> {
  kind: 'type'
  subkind: string
}

export interface PgEnumStmt extends PgTypeStmt<CreateEnumStmt> {
  subkind: 'enum'
  labels: string[]
}

export interface PgCompositeTypeStmt extends PgTypeStmt<CompositeTypeStmt> {
  subkind: 'composite'
  columns: PgColumnDef<ColumnDef>[]
}

export interface PgViewStmt extends IPgObjectStmt<ViewStmt> {
  kind: 'view'
  /**
   * References within the view's subquery to objects that aren't from the
   * `pg_catalog` or `information_schema` namespaces.
   */
  refs: SQLIdentifier[]
  fields: Field[] | null
}

export interface PgSchemaStmt extends IPgObjectStmt<CreateSchemaStmt> {
  kind: 'schema'
}

export interface PgExtensionStmt extends IPgObjectStmt<CreateExtensionStmt> {
  kind: 'extension'
}
