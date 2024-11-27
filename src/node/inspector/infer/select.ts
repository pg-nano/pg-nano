import { $, type SelectStmt } from '@pg-nano/pg-parser'
import type { PgField } from '../types.js'
import { inferExpressionFields } from './expression.js'
import { toQualifiedId } from './identifier.js'
import type { InferenceScope } from './scope.js'

export async function inferSelectedFields(
  selectStmt: SelectStmt,
  scope: InferenceScope,
) {
  const fields: PgField[] = []

  if (selectStmt.withClause) {
    for (const cte of selectStmt.withClause.ctes) {
      const {
        ctename: name,
        aliascolnames: columnAliases,
        ctequery: query,
      } = $(cte)

      if ($.isSelectStmt(query)) {
        const cteFields = await inferSelectedFields(
          query.SelectStmt,
          scope.fork(),
        )
        if (columnAliases) {
          for (let i = 0; i < columnAliases.length; i++) {
            cteFields[i].name = $(columnAliases[i]).sval
          }
        }
        scope.references[name] = {
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
      await resolveReferences(fromExpr, scope)
    }
  }

  const uniqueFields = getUniqueFields(scope)

  for (const target of selectStmt.targetList!) {
    const { name, val, indirection } = $(target)
    if (indirection) {
      throw new Error('Indirection is not supported')
    }
    if (!val) {
      continue
    }
    const exprFields = await inferExpressionFields(val, uniqueFields, scope)
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

type Existent<T> = Exclude<T, undefined>
type FromClause = Existent<SelectStmt['fromClause']>

async function resolveReferences(
  fromExpr: FromClause[number],
  scope: InferenceScope,
) {
  // Ranges
  if ($.isRangeVar(fromExpr)) {
    let { relname: name, alias, schemaname: schema } = $(fromExpr)
    const id = toQualifiedId(name, schema)

    let relation = await scope.resolveRelation(id)
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

    scope.references[name] = relation
  }
  // Joins
  else if ($.isJoinExpr(fromExpr)) {
    const { larg, rarg } = $(fromExpr)
    await Promise.all([
      resolveReferences(larg, scope),
      resolveReferences(rarg, scope),
    ])
  }
  // Subqueries
  else if ($.isRangeSubselect(fromExpr)) {
    const { subquery, alias } = $(fromExpr)
    if (!alias) {
      throw new Error('Subquery alias is required')
    }
    if ($.isSelectStmt(subquery)) {
      const fields = await inferSelectedFields(
        subquery.SelectStmt,
        scope.fork(),
      )
      scope.references[alias.aliasname] = {
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

function getUniqueFields(scope: InferenceScope) {
  const knownFields = Object.values(scope.references).flatMap(r => r.fields)
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
