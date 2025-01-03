import { select, type Expr } from '@pg-nano/pg-parser'
import { map, mapValues, shake } from 'radashi'
import { jsTypeByPgName } from '../../generator/typeMappings.js'
import type { PgField } from '../types.js'
import { inferExpressionField } from './expression.js'
import type { InferenceScope } from './scope.js'

export type PgJsonPrimitive = {
  kind: 'primitive'
  /**
   * TypeScript type representation of the primitive value.
   */
  type: string
  nullable: boolean
}

export type PgJsonArray = {
  kind: 'array'
  elementType: PgJsonType
  nullable: boolean
}

export type PgJsonObject = {
  kind: 'object'
  fields: Record<string, PgJsonType>
  nullable: boolean
}

export type PgJsonUnionType = {
  kind: 'union'
  types: PgJsonConcreteType[]
}

export type PgJsonConcreteType = PgJsonPrimitive | PgJsonArray | PgJsonObject
export type PgJsonType = PgJsonConcreteType | PgJsonUnionType

export async function inferJsonObjectType(
  fields: [Expr, Expr][],
  nullable: boolean,
  uniqueFields: Record<string, PgField>,
  scope: InferenceScope,
): Promise<PgJsonType> {
  let jsonFields: [string, PgJsonType][] | undefined
  try {
    jsonFields = await map(fields, async ([key, value]) => {
      const keyName = select(key, 'sval.sval')
      if (!keyName) {
        // Throw null to indicate an unsupported key type.
        throw null
      }
      const valueType = await inferJsonType(value, uniqueFields, scope)
      return [keyName, valueType]
    })
  } catch (error: any) {
    if (error !== null) {
      throw error
    }
  }
  if (jsonFields) {
    return {
      kind: 'object',
      fields: Object.fromEntries(jsonFields),
      nullable,
    }
  }
  return {
    kind: 'primitive',
    type: 'JSON',
    nullable,
  }
}

export async function inferJsonType(
  expr: Expr,
  uniqueFields: Record<string, PgField>,
  scope: InferenceScope,
): Promise<PgJsonType> {
  let { typeOid, nullable, jsonType, ndims } = await inferExpressionField(
    expr,
    uniqueFields,
    scope,
  )

  if (jsonType) {
    return jsonType
  }

  const typeName = await scope.getTypeName(typeOid)

  if (typeName.schema && typeName.schema !== 'pg_catalog') {
    return {
      kind: 'primitive',
      type: 'JSON',
      nullable,
    }
  }

  jsonType = {
    kind: 'primitive',
    type: jsPrimitiveTypes[typeName.name] ?? 'JSON',
    nullable: !ndims ? nullable : false,
  }
  if (ndims && ndims > 0) {
    for (let i = ndims; i > 0; i--) {
      jsonType = {
        kind: 'array',
        elementType: jsonType,
        nullable: i === 1 ? nullable : false,
      }
    }
  }
  return jsonType
}

const jsPrimitiveTypes: Record<string, string | undefined> = {
  ...shake(
    mapValues(
      jsTypeByPgName,
      (() => {
        const jsonTypes = new Set(['number', 'string', 'boolean', 'JSON'])
        return value => (jsonTypes.has(value) ? value : undefined)
      })(),
    ),
  ),
  bpchar: 'string',
  char: 'string',
  citext: 'string',
  name: 'string',
  text: 'string',
  uuid: 'string',
  varchar: 'string',
}

/**
 * Render a Postgres JSON type to a TypeScript type string.
 */
export function renderJsonType(t: PgJsonType, includeNulls = true): string {
  switch (t.kind) {
    case 'primitive':
      return t.type + (includeNulls && t.nullable ? ' | null' : '')
    case 'array': {
      let elementType = renderJsonType(t.elementType, includeNulls)
      if (t.elementType.kind === 'union' || t.elementType.nullable) {
        elementType = `(${elementType})`
      }
      return `${elementType}[]` + (includeNulls && t.nullable ? ' | null' : '')
    }
    case 'object':
      return (
        `{ ${Object.entries(t.fields)
          .map(([k, v]) => `${k}: ${renderJsonType(v, includeNulls)}`)
          .join(', ')} }` + (includeNulls && t.nullable ? ' | null' : '')
      )
    case 'union':
      return (
        t.types.map(type => renderJsonType(type, false)).join(' | ') +
        (includeNulls && t.types.some(type => type.nullable) ? ' | null' : '')
      )
  }
}
