import type { UserConfig } from './configTypes'

export function defineConfig(config: UserConfig) {
  return config
}

export * from './configResolver'
export * from './configTypes'
