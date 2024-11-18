import { omit, pick, type Simplify } from 'radashi'
import type { UserConfig } from './configTypes.js'

type OptionalKeys<T> = keyof T extends infer K
  ? K extends keyof T
    ? Omit<T, K> extends T
      ? K
      : never
    : never
  : never

type NonPartial<T> = Simplify<
  Omit<T, OptionalKeys<T>> & { [K in OptionalKeys<T>]-?: T[K] | undefined }
>

export function mergeConfig(
  left: UserConfig,
  right: Partial<UserConfig>,
): NonPartial<UserConfig> {
  const connectionKeys = ['connectionString', 'connection'] as const

  // Avoid spreading {...left, ...right} because it's more mistake-prone than
  // individually merging properties.
  return {
    plugins: [...(left.plugins ?? []), ...(right.plugins ?? [])],
    dev: right.dev
      ? {
          ...omit(left.dev, connectionKeys),
          ...omit(right.dev, connectionKeys),
          // Only one connection key is allowed.
          ...firstNotEmpty(
            pick(right.dev, connectionKeys),
            pick(left.dev, connectionKeys),
          ),
        }
      : left.dev,
    generate: {
      ...left.generate,
      ...right.generate,
    },
    migration: {
      ...left.migration,
      ...right.migration,
    },
    schema: right.schema ?? left.schema,
  }
}

function firstNotEmpty<T extends object>(...values: T[]) {
  return values.find(value => Object.keys(value).length > 0)
}
