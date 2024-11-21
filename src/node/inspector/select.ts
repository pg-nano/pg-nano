import {
  $,
  parseQuery,
  select,
  type Expr,
  type QualifiedName,
  type SelectStmt,
} from '@pg-nano/pg-parser'
import { sql, type Client } from 'pg-nano'
import { memoAsync } from '../util/memoAsync.js'
import { inspectResultSet } from './inspect.js'
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
} from './types.js'

export async function inspectSelect(
  client: Client,
  selectStmt: SelectStmt,
  objects: PgObject[],
  signal?: AbortSignal,
): Promise<PgField[]> {
  const ctx = new SelectContext(client, objects, signal)
  return getSelectedFields(selectStmt, ctx)
}

type Relation = {
  type: PgObjectType | 'cte' | 'subquery'
  fields: (PgTableField | PgField)[]
}

type TypeName = {
  name: string
  schema: string
  array: boolean
}

type Mutable<T> = {
  -readonly [P in keyof T]: T[P]
}

class SelectContext {
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
   * Create a new context with a fresh set of references. This is useful for
   * subqueries.
   */
  extend() {
    const ctx = Object.create(this)
    ctx.references = {}
    return ctx as SelectContext
  }

  getReturnType = memoAsync(
    async (name: string, argTypes: string[]) => {
      const signature = `${name}(${argTypes.join(',')})`

      return this.pg.queryValue<string>(sql`
        SELECT pg_get_function_result(${sql.val(signature)}::regprocedure)
      `)
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
    return this.pg.queryRow<TypeName>(sql`
      SELECT
        t.typname AS "name",
        n.nspname AS "schema",
        (t.typarray = ${sql.val(typeOid)}) AS "array"
      FROM pg_type t
      JOIN pg_namespace n ON t.typnamespace = n.oid
      WHERE (t.oid = ${sql.val(typeOid)} AND t.typname NOT LIKE '\_%') 
         OR t.typarray = ${sql.val(typeOid)}
    `)
  })

  getTypeOid = memoAsync(
    async (name: string, schema?: string, array = false) => {
      const id = schema ? `${schema}.${name}` : name
      const type = this.types[id]
      if (type) {
        return array ? type.arrayOid : type.oid
      }
      return this.pg.queryValue<number>(sql`
        SELECT ${sql.id(array ? 'typarray' : 'oid')}
        FROM pg_type
        WHERE typname = ${sql.val(name)}${schema && sql` AND typnamespace = ${sql.val(schema)}::regnamespace`}
      `)
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
      return await getSelectedFields(selectStmt, this.extend())
    } catch (error) {
      console.warn(error)

      // Fallback to asking the database directly. The downside of this is the
      // lack of nullability hints.
      return inspectResultSet(this.pg, sql.unsafe(view.query), this.signal)
    }
  })
}

async function getSelectedFields(selectStmt: SelectStmt, ctx: SelectContext) {
  const fields: PgField[] = []

  if (selectStmt.withClause) {
    for (const cte of selectStmt.withClause.ctes) {
      const {
        ctename: name,
        aliascolnames: columnAliases,
        ctequery: query,
      } = $(cte)

      if ($.isSelectStmt(query)) {
        const cteFields = await getSelectedFields(
          query.SelectStmt,
          ctx.extend(),
        )
        if (columnAliases) {
          for (let i = 0; i < columnAliases.length; i++) {
            cteFields[i].name = $(columnAliases[i]).sval
          }
        }
        ctx.references[name] = {
          type: 'cte',
          fields: cteFields,
        }
      } else {
        throw new Error(
          'CTE statements other than SELECT are not yet supported',
        )
      }
    }
  }

  if (selectStmt.fromClause) {
    for (const fromExpr of selectStmt.fromClause) {
      await resolveReferences(fromExpr, ctx)
    }
  }

  const uniqueFields = getUniqueFields(ctx)

  for (const target of selectStmt.targetList!) {
    const { name, val, indirection } = $(target)
    if (indirection) {
      throw new Error('Indirection is not supported')
    }
    if (!val) {
      continue
    }
    const exprFields = await inspectExpression(val, uniqueFields, ctx)
    if (!exprFields.length) {
      throw new Error(`Failed to inspect expression: ${Object.keys(val)[0]}`)
    }
    if (name != null) {
      const field = { ...exprFields[0] }
      field.name = name
      fields.push(field)
    } else {
      fields.push(...exprFields)
    }
  }

  return fields
}

async function inspectExpression(
  expr: Expr,
  uniqueFields: Record<string, PgField>,
  ctx: SelectContext,
): Promise<PgField[]> {
  if ($.isColumnRef(expr)) {
    const refs = $(expr).fields
    const lastRef = refs.at(-1)!

    if ($.isA_Star(lastRef)) {
      const relationName = select(refs.at(-2)!, 'sval')!
      const relation = ctx.references[relationName]
      if (!relation) {
        throw new Error(`Unknown relation: ${relationName}`)
      }
      return relation.fields
    }

    if (refs.length === 1) {
      const fieldName = select(refs[0], 'sval')!
      const field = uniqueFields[fieldName]
      if (!field) {
        throw new Error(`Unknown field: ${fieldName}`)
      }
      return [field]
    }

    const relationName = select(refs[0], 'sval')!
    const relation = ctx.references[relationName]
    if (!relation) {
      throw new Error(`Unknown relation: ${relationName}`)
    }

    const fieldName = select(refs[1], 'sval')!
    const field = relation.fields.find(f => f.name === fieldName)
    if (!field) {
      throw new Error(`Column "${relationName}"."${fieldName}" does not exist`)
    }

    return [field]
  }

  if ($.isFuncCall(expr)) {
    const { funcname: name, args } = $(expr)

    const inspectedArgs =
      args &&
      (await Promise.all(
        args.map(async arg => {
          const fields = await inspectExpression(arg, uniqueFields, ctx)
          return fields[0]
        }),
      ))

    const argTypes = inspectedArgs
      ? await Promise.all(
          inspectedArgs.map(async f => {
            const typeName = await ctx.getTypeName(f.typeOid)
            return `${typeName.schema}.${typeName.name}${typeName.array ? '[]' : ''}`
          }),
        )
      : []

    const id = parseQualifiedName(name)
    const qualifiedId = toQualifiedId(id.name, id.schema)
    const returnType = await ctx.getReturnType(qualifiedId, argTypes)
    const returnTypeOid = await ctx.getTypeOid(returnType)

    // TODO: inspect user-defined routines to determine nullability
    let hasNotNull = inspectedArgs?.every(arg => arg.hasNotNull) ?? true

    if (!id.schema || id.schema === 'pg_catalog') {
      const attrs = functionAttributes[id.name] ?? {}
      if (attrs.nullable) {
        hasNotNull = false
      }
    }

    return [
      {
        name: id.name,
        typeOid: returnTypeOid,
        hasNotNull,
      },
    ]
  }

  if ($.isTypeCast(expr)) {
    const { arg, typeName } = $(expr)

    const argFields = await inspectExpression(arg, uniqueFields, ctx)
    const typeId = parseQualifiedName(typeName.names)
    const typeOid = await ctx.getTypeOid(typeId.name, typeId.schema)

    return [
      {
        name: argFields[0].name || typeId.name,
        typeOid,
        hasNotNull: argFields[0].hasNotNull,
      },
    ]
  }

  if ($.isA_ArrayExpr(expr)) {
    const { elements } = $(expr)

    const elementFields =
      elements &&
      (await Promise.all(
        elements.map(async element => {
          const fields = await inspectExpression(element, uniqueFields, ctx)
          return fields[0]
        }),
      ))

    let typeOid: number

    if (elementFields && elementFields.length > 0) {
      // Assume all elements have the same type as the first one.
      const elementTypeOid = elementFields?.[0].typeOid
      const elementType = await ctx.getTypeName(elementTypeOid)

      typeOid = await ctx.getTypeOid(elementType.name, elementType.schema, true)
    } else {
      typeOid = await ctx.getTypeOid('unknown', 'pg_catalog', true)
    }

    return [
      {
        name: 'array',
        typeOid,
        // Arrays themselves are not null, even if they contain null elements.
        hasNotNull: true,
      },
    ]
  }

  throw new Error(`Unsupported expression type: ${Object.keys(expr)[0]}`)
}

async function resolveRelation(
  id: string,
  ctx: SelectContext,
): Promise<Relation> {
  const relation = ctx.relations[id]
  if (relation.type === PgObjectType.View) {
    relation.fields ??= await ctx.getViewFields(relation)
  }
  return relation as Relation
}

type Existent<T> = Exclude<T, undefined>
type FromClause = Existent<SelectStmt['fromClause']>

async function resolveReferences(
  fromExpr: FromClause[number],
  ctx: SelectContext,
) {
  // Ranges
  if ($.isRangeVar(fromExpr)) {
    let { relname: name, alias, schemaname: schema } = $(fromExpr)
    const id = toQualifiedId(name, schema)

    let relation: Relation = await resolveRelation(id, ctx)
    if (!relation) {
      throw new Error(`Unknown relation: ${id}`)
    }

    if (alias) {
      name = alias.aliasname
      if (alias.colnames) {
        relation = {
          type: relation.type,
          fields: alias.colnames.map((alias, i) => {
            const field = { ...relation.fields[i] }
            field.name = $(alias).sval
            return field
          }),
        }
      }
    }

    ctx.references[name] = relation
  }
  // Joins
  else if ($.isJoinExpr(fromExpr)) {
    const { larg, rarg } = $(fromExpr)
    await Promise.all([
      resolveReferences(larg, ctx),
      resolveReferences(rarg, ctx),
    ])
  }
  // Subqueries
  else if ($.isRangeSubselect(fromExpr)) {
    const { subquery, alias } = $(fromExpr)
    if (!alias) {
      throw new Error('Subquery alias is required')
    }
    if ($.isSelectStmt(subquery)) {
      const fields = await getSelectedFields(subquery.SelectStmt, ctx)
      ctx.references[alias.aliasname] = {
        type: 'subquery',
        fields:
          alias.colnames?.map((alias, i) => {
            const field = { ...fields[i] }
            field.name = $(alias).sval
            return field
          }) ?? fields,
      }
    } else {
      throw new Error('Subqueries other than SELECT are not yet supported')
    }
  }
  // Range-returning function calls
  else if ($.isRangeFunction(fromExpr)) {
    throw new Error('Range functions are not yet supported')
  }
  // Everything else
  else {
    throw new Error(`Unsupported FROM clause node: ${Object.keys(fromExpr)[0]}`)
  }
}

type FunctionAttributes = {
  /**
   * Whether the function can return NULL even if every input parameter is
   * non-NULL.
   */
  nullable?: boolean
}

const functionAttributes: Record<string, FunctionAttributes> = {
  jsonb_extract_path_text: {
    // NULL if the path does not exist
    nullable: true,
  },
  json_extract_path_text: {
    // NULL if the path does not exist
    nullable: true,
  },
  array_position: {
    // Out of bounds returns NULL
    nullable: true,
  },
}

function toQualifiedId(name: string, schema: string | undefined) {
  return schema && schema !== 'public' ? `${schema}.${name}` : name
}

function parseQualifiedName(names: QualifiedName) {
  let schema: string | undefined
  let name: string
  if (names.length === 1) {
    name = $(names[0]).sval
  } else {
    schema = $(names.at(-2)!).sval
    name = $(names.at(-1)!).sval
  }
  return { schema, name }
}

function getUniqueFields(ctx: SelectContext) {
  const knownFields = Object.values(ctx.references).flatMap(r => r.fields)
  const duplicateFields = nonUnique(knownFields.map(f => f.name))
  const uniqueFields: Record<string, PgField> = {}

  for (const field of knownFields) {
    if (!duplicateFields.includes(field.name)) {
      uniqueFields[field.name] = field
    }
  }

  return uniqueFields
}

function nonUnique<T>(array: readonly T[]) {
  const seen = new Set<T>()
  return array.filter(value => {
    if (seen.has(value)) {
      return true
    }
    seen.add(value)
    return false
  })
}
