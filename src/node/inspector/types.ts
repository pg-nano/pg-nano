import type { Plugin } from '../config/plugin'

export type PgField = {
  name: string
  typeOid: number
  hasNotNull: boolean
  ndims?: number | undefined
}

export enum PgIdentityKind {
  None = '',
  Always = 'a',
  Default = 'd',
}

export type PgTableField = PgField & {
  hasDefault: boolean
  identity: PgIdentityKind
}

export type PgTable = {
  type: PgObjectType.Table
  oid: number
  name: string
  schema: string
  arrayOid: number
  fields: PgTableField[]
  /**
   * If a plugin generated this table, it will be set here.
   */
  plugin?: Plugin | undefined
}

export type PgView = {
  type: PgObjectType.View
  oid: number
  name: string
  schema: string
  arrayOid: number
  query: string
  fields: PgField[] | null
  /**
   * If a plugin generated this view, it will be set here.
   */
  plugin?: Plugin | undefined
}

export type PgCompositeType = {
  type: PgObjectType.Composite
  oid: number
  name: string
  schema: string
  arrayOid: number
  fields: PgField[]
  /**
   * If a plugin generated this type, it will be set here.
   */
  plugin?: Plugin | undefined
}

export type PgEnumType = {
  type: PgObjectType.Enum
  oid: number
  name: string
  schema: string
  arrayOid: number
  labels: string[]
  /**
   * If a plugin generated this type, it will be set here.
   */
  plugin?: Plugin
}

export type PgBaseType = {
  type: PgObjectType.Base
  oid: number
  name: string
  schema: string
  arrayOid: number
  /**
   * Base types cannot be generated by plugins.
   */
  plugin?: undefined
}

export enum PgParamKind {
  In = 'i',
  Out = 'o',
  InOut = 'b',
  Variadic = 'v',
  Table = 't',
}

export enum PgRoutineKind {
  Function = 'f',
  Procedure = 'p',
}

export type PgRoutine = {
  type: PgObjectType.Routine
  kind: PgRoutineKind
  oid: number
  name: string
  schema: string
  paramNames: string[] | null
  /** Space-separated list of argument types */
  paramTypes: number[]
  paramKinds: PgParamKind[] | null
  numDefaultParams: number
  returnTypeOid: number
  returnSet: boolean
  isVariadic: boolean
  /**
   * If a plugin generated this function, it will be set here.
   */
  plugin?: Plugin | undefined
  /**
   * This can be set by a plugin to override the inferred constructor used to
   * declare the routine proxy in TypeScript.
   */
  bindingFunction?: PgRoutineBindingFunction | undefined
}

export type PgRoutineBindingFunction =
  keyof typeof import('../../core/routines.js')

export type PgNamespace = {
  schema: string
  routines: PgRoutine[]
  compositeTypes: PgCompositeType[]
  enumTypes: PgEnumType[]
  tables: PgTable[]
  views: PgView[]
  /**
   * The names of every object in this namespace.
   */
  names: string[]
}

export type PgObject =
  | PgRoutine
  | PgTable
  | PgView
  | PgEnumType
  | PgCompositeType
  | PgBaseType

export enum PgObjectType {
  Base = 'base type',
  Composite = 'composite type',
  Enum = 'enum type',
  Routine = 'routine',
  Table = 'table',
  View = 'view',
}

export type PgType = (
  | { object: Readonly<PgEnumType> }
  | { object: Readonly<PgCompositeType> }
  | { object: Readonly<PgTable> }
  | { object: Readonly<PgView> }
  | { object: Readonly<PgBaseType> }
) & {
  isArray?: boolean | undefined
  jsType: string
}

type ReadonlyUnion<T> = T extends any ? Readonly<T> : never

export type PgTypeContext = {
  /**
   * The type being mapped.
   */
  type: Readonly<PgType>
  /**
   * The object that contains this type.
   */
  container: ReadonlyUnion<Exclude<PgObject, PgEnumType>>
  /**
   * The field that contains this type, if any.
   */
  field?: ReadonlyUnion<PgField | PgTableField> | undefined
  /**
   * The name of the field, always in snake_case. Note that function parameters
   * with a "p_" prefix will have the prefix stripped.
   *
   * If `this.container` is a function, this may be a dollar-prefixed number
   * (e.g. `"$1"` for an unnamed parameter) or `undefined` for an unnamed
   * `RETURNS` value.
   */
  fieldName?: string | undefined
  /**
   * The kind of parameter this type represents, if this type is a parameter.
   * This includes result parameters (a.k.a. OUT parameters).
   */
  paramKind?: PgParamKind | undefined
  /**
   * The index of the parameter this type represents, if this type is a
   * parameter.
   */
  paramIndex?: number | undefined
}

export type PgFieldContext = {
  /**
   * The object that contains this field.
   */
  container: ReadonlyUnion<Exclude<PgObject, PgEnumType>>
  /**
   * The name of the field, always in snake_case. Note that function parameters
   * with a "p_" prefix will have the prefix stripped.
   *
   * If `this.container` is a function, this may be an empty string (for an
   * unnamed `RETURNS` value) or a dollar-prefixed number (e.g. `"$1"` for an
   * unnamed parameter).
   */
  fieldName: string
  /**
   * The type of the field.
   */
  fieldType: PgType
  /**
   * The depth of array nesting for this field.
   */
  ndims?: number | undefined
  /**
   * The row type that `this.field` belongs to, if `this.container` is a function.
   */
  rowType?: ReadonlyUnion<PgCompositeType | PgTable | PgView> | undefined
  /**
   * The kind of parameter this field represents, if `this.container` is a
   * function.
   */
  paramKind?: PgParamKind | undefined
  /**
   * The index of the parameter this field represents, if `this.container` is a
   * function and `this.paramKind` is either `PgParamKind.In` or
   * `PgParamKind.InOut`.
   */
  paramIndex?: number | undefined
}

export function isEnumType(
  type: PgType,
): type is PgType & { object: Readonly<PgEnumType> } {
  return type.object.type === PgObjectType.Enum
}

export function isCompositeType(
  type: PgType,
): type is PgType & { object: Readonly<PgCompositeType> } {
  return type.object.type === PgObjectType.Composite
}

export function isTableType(
  type: PgType,
): type is PgType & { object: Readonly<PgTable> } {
  return type.object.type === PgObjectType.Table
}

export function isViewType(
  type: PgType,
): type is PgType & { object: Readonly<PgView> } {
  return type.object.type === PgObjectType.View
}

export function isBaseType(
  type: PgType,
): type is PgType & { object: Readonly<PgBaseType> } {
  return type.object.type === PgObjectType.Base
}
