import { parseQuerySync, select, type TypeName } from '@pg-nano/pg-parser'
import { sql, type SQLTemplateValue } from 'pg-native'
import { arrayEquals } from '../util/arrayEquals.js'
import { parseQualifiedName, SQLIdentifier } from './identifier.js'

export class SQLTypeIdentifier extends SQLIdentifier {
  static fromTypeName(typeName: TypeName): SQLTypeIdentifier {
    const id = Object.assign(
      new SQLTypeIdentifier(''),
      parseQualifiedName(typeName.names, typeName.pct_type),
    )
    if (typeName.typmods) {
      id.typeModifiers = typeName.typmods.map(typmod => {
        const ival = select(typmod, 'ival.ival')
        if (ival === undefined) {
          throw new Error('expected ival')
        }
        return ival
      })
    }
    if (typeName.arrayBounds) {
      id.arrayBounds = typeName.arrayBounds.map(
        bound => bound.Integer.ival ?? null,
      )
    }
    return id
  }

  static parse(input: string) {
    const ast = parseQuerySync(`SELECT 1::${input}`)
    const targetList = select(ast.stmts[0].stmt, 'targetList')!
    const typeName = select(targetList[0], 'val.typeName')!
    return SQLTypeIdentifier.fromTypeName(typeName)
  }

  /**
   * Exists if referencing a type with type modifiers.
   *
   * @example varchar(10) => [10]
   */
  public typeModifiers?: number[] | undefined

  /**
   * Exists if referencing an array type. One element indicates a 1-dimensional
   * array, two elements indicates a 2-dimensional array, etc. If a dimension is
   * `-1` or `null`, then the array is unbounded in that dimension. Otherwise,
   * the value is the upper bound of the array in that dimension.
   */
  public arrayBounds?: (number | null)[] | undefined

  /**
   * Returns an identifier that references the type itself, not the type with
   * modifiers or array bounds.
   */
  toIdentifier() {
    return new SQLIdentifier(this.name, this.schema)
  }

  override toSQL(defaultSchema?: string): SQLTemplateValue {
    const id = super.toSQL(defaultSchema)

    const typeModifiers = this.typeModifiers
      ? sql.unsafe(this.stringifyTypeModifiers())
      : ''

    const arrayBounds = this.arrayBounds
      ? sql.unsafe(this.stringifyArrayBounds())
      : ''

    if (typeModifiers || arrayBounds) {
      return [id, typeModifiers, arrayBounds]
    }
    return id
  }

  override toQualifiedName(defaultSchema?: string) {
    return (
      super.toQualifiedName(defaultSchema) +
      this.stringifyTypeModifiers() +
      this.stringifyArrayBounds()
    )
  }

  override equals(other: SQLTypeIdentifier): boolean {
    return (
      super.equals(other) &&
      arrayEquals(this.typeModifiers, other.typeModifiers) &&
      arrayEquals(this.arrayBounds, other.arrayBounds)
    )
  }

  private stringifyTypeModifiers() {
    return this.typeModifiers ? `(${this.typeModifiers.join(', ')})` : ''
  }

  private stringifyArrayBounds() {
    return (
      this.arrayBounds
        ?.map(bound => `[${bound === -1 ? '' : bound ?? ''}]`)
        .join('') ?? ''
    )
  }
}
