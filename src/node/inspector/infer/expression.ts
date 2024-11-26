import {
  $,
  select,
  SubLinkType,
  type Expr,
  type QualifiedName,
} from '@pg-nano/pg-parser'
import type { PgField } from '../types.js'
import { toQualifiedId } from './identifier.js'
import type { InferenceScope } from './scope.js'
import { inferSelectedFields } from './select.js'

export async function inferExpressionType(
  expr: Expr,
  uniqueFields: Record<string, PgField>,
  scope: InferenceScope,
): Promise<PgField[]> {
  if ($.isColumnRef(expr)) {
    const refs = $(expr).fields
    const lastRef = refs.at(-1)!

    if ($.isA_Star(lastRef)) {
      const relationName = select(refs.at(-2)!, 'sval')!
      const relation = scope.references[relationName]
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
    const relation = scope.references[relationName]
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
          const fields = await inferExpressionType(arg, uniqueFields, scope)
          return fields[0]
        }),
      ))

    const argTypes = inspectedArgs
      ? await Promise.all(
          inspectedArgs.map(async f => {
            const typeName = await scope.getTypeName(f.typeOid)
            return `${typeName.schema}.${typeName.name}${typeName.array ? '[]' : ''}`
          }),
        )
      : []

    const id = parseQualifiedName(name)
    const qualifiedId = toQualifiedId(id.name, id.schema)
    const returnType = await scope.getReturnType(qualifiedId, argTypes)
    const returnTypeOid = await scope.getTypeOid(returnType)

    // TODO: inspect user-defined routines to determine nullability
    let nullable = inspectedArgs?.some(arg => arg.nullable) ?? false

    if (!id.schema || id.schema === 'pg_catalog') {
      const attrs = functionAttributes[id.name] ?? {}
      if (attrs.nullable) {
        nullable = true
      }
    }

    return [
      {
        name: id.name,
        typeOid: returnTypeOid,
        nullable,
      },
    ]
  }

  if ($.isTypeCast(expr)) {
    const { arg, typeName } = $(expr)

    const argFields = await inferExpressionType(arg, uniqueFields, scope)
    const typeId = parseQualifiedName(typeName.names)
    const typeOid = await scope.getTypeOid(typeId.name, typeId.schema)

    return [
      {
        name: argFields[0].name || typeId.name,
        typeOid,
        nullable: argFields[0].nullable,
        ndims: typeName.arrayBounds?.length,
      },
    ]
  }

  if ($.isA_Const(expr)) {
    const { A_Const: constExpr } = expr

    let typeOid: number
    let nullable = false

    if ('boolval' in constExpr) {
      typeOid = await scope.getTypeOid('bool', 'pg_catalog')
    } else if ('bsval' in constExpr) {
      typeOid = await scope.getTypeOid('bit varying', 'pg_catalog')
    } else if ('fval' in constExpr) {
      typeOid = await scope.getTypeOid('float8', 'pg_catalog')
    } else if ('isnull' in constExpr) {
      typeOid = await scope.getTypeOid('unknown', 'pg_catalog')
      nullable = true
    } else if ('ival' in constExpr) {
      typeOid = await scope.getTypeOid('int8', 'pg_catalog')
    } else if ('sval' in constExpr) {
      typeOid = await scope.getTypeOid('text', 'pg_catalog')
    } else {
      throw new Error('Invalid A_Const value')
    }

    return [
      {
        name: 'const',
        typeOid,
        nullable,
      },
    ]
  }

  if ($.isA_ArrayExpr(expr)) {
    const { elements } = $(expr)

    const elementFields =
      elements &&
      (await Promise.all(
        elements.map(async element => {
          const fields = await inferExpressionType(element, uniqueFields, scope)
          return fields[0]
        }),
      ))

    let typeOid: number

    if (elementFields && elementFields.length > 0) {
      // Assume all elements have the same type as the first one.
      const elementTypeOid = elementFields?.[0].typeOid
      const elementType = await scope.getTypeName(elementTypeOid)

      typeOid = await scope.getTypeOid(
        elementType.name,
        elementType.schema,
        true,
      )
    } else {
      typeOid = await scope.getTypeOid('unknown', 'pg_catalog', true)
    }

    return [
      {
        name: 'array',
        typeOid,
        // Arrays themselves are not null, even if they contain null elements.
        nullable: false,
      },
    ]
  }

  if ($.isSubLink(expr)) {
    const subselect = $(expr).subselect.SelectStmt
    switch ($(expr).subLinkType) {
      case SubLinkType.EXPR_SUBLINK: {
        const fields = await inferSelectedFields(subselect, scope.fork())
        return [fields[0]]
      }
      case SubLinkType.ARRAY_SUBLINK: {
        const fields = await inferSelectedFields(subselect, scope.fork())
        return [{ ...fields[0], ndims: 1 }]
      }
    }
  }

  throw new Error(`Unsupported expression type: ${Object.keys(expr)[0]}`)
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
