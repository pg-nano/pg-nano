import { parseQuery, type SelectStmt } from '@pg-nano/pg-parser'
import { sql, type Client } from 'pg-nano'
import { memoAsync } from '../../util/memoAsync.js'
import { inspectResultSet } from '../inspect.js'
import {
  PgObjectType,
  type PgBaseType,
  type PgCompositeType,
  type PgEnumType,
  type PgField,
  type PgObject,
  type PgTable,
  type PgTableField,
  type PgView,
} from '../types.js'
import { toQualifiedId } from './identifier.js'
import { inferSelectedFields } from './select.js'

type Mutable<T> = {
  -readonly [P in keyof T]: T[P]
}

type TypeName = {
  name: string
  schema: string
  array: boolean
}

type Relation = {
  type: PgObjectType | 'cte' | 'subquery'
  fields: (PgTableField | PgField)[]
}

export class InferenceScope {
  /** Range references declared in this statement */
  readonly references: Record<string, Relation> = {}
  /** User-defined relations in the database */
  readonly relations: Readonly<Record<string, PgTable | PgView>> = {}
  /** User-defined types in the database */
  readonly types: Readonly<
    Record<string, PgTable | PgView | PgEnumType | PgCompositeType | PgBaseType>
  > = {}
  /** User-defined types by OID */
  readonly typesByOid: Readonly<
    Record<
      number,
      Required<PgTable | PgView | PgEnumType | PgCompositeType | PgBaseType>
    >
  > = {}

  constructor(
    readonly pg: Client,
    objects: PgObject[],
    readonly signal?: AbortSignal,
  ) {
    const relations: Mutable<typeof this.relations> = (this.relations = {})
    const types: Mutable<typeof this.types> = (this.types = {})

    for (const object of objects) {
      const id = toQualifiedId(object.name, object.schema)

      switch (object.type) {
        case PgObjectType.Table:
        case PgObjectType.View:
          relations[object.name] = relations[id] = object
        /* passthrough */
        case PgObjectType.Base:
        case PgObjectType.Composite:
        case PgObjectType.Enum:
          types[object.name] = types[id] = object
          break
      }
    }

    const typesByOid: Mutable<typeof this.typesByOid> = (this.typesByOid = {})
    for (const type of Object.values(types)) {
      typesByOid[type.oid] = type
      if (type.arrayOid) {
        typesByOid[type.arrayOid] = type
      }
    }
  }

  /**
   * Create a new scope that extends this one, but has its own set of
   * references. This is useful for subqueries.
   */
  fork(): InferenceScope {
    const scope: Mutable<InferenceScope> = Object.create(this)
    scope.references = {}
    return scope
  }

  getReturnType = memoAsync(
    async (name: string, argTypes: string[]) => {
      const signature = `${name}(${argTypes.join(',')})`

      return this.pg
        .queryValue<string>(sql`
          SELECT pg_get_function_result(${sql.val(signature)}::regprocedure)
        `)
        .cancelWithSignal(this.signal)
    },
    {
      toKey: (name, argTypes) => `${name}(${argTypes.join(',')})`,
    },
  )

  getTypeName = memoAsync(async (typeOid: number): Promise<TypeName> => {
    const type = this.typesByOid[typeOid]
    if (type) {
      return {
        name: type.name,
        schema: type.schema,
        array: type.arrayOid === typeOid,
      }
    }
    try {
      return await this.pg
        .queryRow<TypeName>(sql`
          SELECT
            t.typname AS "name",
            n.nspname AS "schema",
            (t.typarray = ${sql.val(typeOid)}) AS "array"
          FROM pg_type t
          JOIN pg_namespace n ON t.typnamespace = n.oid
          WHERE (t.oid = ${sql.val(typeOid)} AND t.typname NOT LIKE '\\_%')
            OR t.typarray = ${sql.val(typeOid)}
        `)
        .cancelWithSignal(this.signal)
    } catch (error: any) {
      error.message = `Failed to get type name for OID ${typeOid}: ${error.message}`
      throw error
    }
  })

  getTypeOid = memoAsync(
    async (name: string, schema?: string, array?: boolean) => {
      const id = schema ? `${schema}.${name}` : name
      const type = this.types[id]
      if (type) {
        return array ? type.arrayOid : type.oid
      }
      return this.pg
        .queryValue<number>(sql`
          SELECT ${sql.id(array ? 'typarray' : 'oid')}
          FROM pg_type
          WHERE typname = ${sql.val(name)}${schema && sql` AND typnamespace = ${sql.val(schema)}::regnamespace`}
        `)
        .cancelWithSignal(this.signal)
    },
    {
      toKey: (name, schema, array) =>
        (schema ? `${schema}.${name}` : name) + (array ? '[]' : ''),
    },
  )

  getViewFields = memoAsync(async (view: PgView) => {
    const ast = await parseQuery(view.query)
    const selectStmt = (ast.stmts[0].stmt as { SelectStmt: SelectStmt })
      .SelectStmt

    try {
      return await inferSelectedFields(selectStmt, this.fork())
    } catch (error) {
      console.warn(error)

      // Fallback to asking the database directly. The downside of this is the
      // lack of nullability hints.
      return inspectResultSet(this.pg, sql.unsafe(view.query), this.signal)
    }
  })

  async resolveRelation(id: string): Promise<Relation> {
    const relation = this.relations[id]
    if (relation.type === PgObjectType.View) {
      relation.fields ??= await this.getViewFields(relation)
    }
    return relation as Relation
  }
}
