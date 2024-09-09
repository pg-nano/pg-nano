export type UnwrapArray<T> = T extends any[] ? T[number] : T

export function arrifyParams(params: object, names: string[]) {
  const values: unknown[] = []
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(params, name)) {
      values.push(params[name as keyof object])
    } else {
      break
    }
  }
  return values
}
