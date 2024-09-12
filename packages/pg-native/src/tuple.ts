// biome-ignore lint/complexity/noStaticOnlyClass:
export class Tuple<T = unknown> extends Array<T> {
  static isTuple(value: unknown): value is Tuple {
    return value != null && value.constructor === Tuple
  }
}
