import type { UserConfig } from './configTypes'

export function defineConfig(config: UserConfig) {
  return config
}

export * from './configTypes'
export * from './mergeConfig'
export * from './resolveConfig'
