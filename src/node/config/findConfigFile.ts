import { existsSync } from 'node:fs'
import path from 'node:path'

const configFileName = 'pg-nano.config.ts'

/**
 * The default logic for finding the config file.
 */
export function findConfigFile(cwd: string): string | null {
  let currentDir = cwd

  const root = path.parse(cwd).root

  while (true) {
    const configPath = path.join(currentDir, configFileName)

    if (existsSync(configPath)) {
      return configPath
    }

    const parentDir = path.dirname(currentDir)
    if (parentDir === root) {
      return null
    }

    currentDir = parentDir
  }
}
