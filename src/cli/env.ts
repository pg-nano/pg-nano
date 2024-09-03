import type { UserConfig } from '@pg-nano/config'
import { bundleRequire } from 'bundle-require'
import path from 'node:path'
import { allMigrationHazardTypes } from '../config/hazards'
import { findConfigFile } from './findConfigFile'
import { log } from './log'

export type EnvOptions = {
  dsn?: string
  /** Skip cache and reload environment */
  forceReload?: boolean
}

const cache = new Map<string, Promise<Env>>()

export type Env = Awaited<ReturnType<typeof loadEnv>>

export function getEnv(cwd: string, options: EnvOptions = {}) {
  const key = JSON.stringify([cwd, options.dsn])
  if (!options.forceReload && cache.has(key)) {
    return cache.get(key)!
  }
  const env = loadEnv(cwd, options)
  cache.set(key, env)
  return env
}

async function loadEnv(cwd: string, options: EnvOptions) {
  const configFilePath = findConfigFile(cwd)
  const root = configFilePath ? path.dirname(configFilePath) : cwd
  const untrackedDir = path.join(root, 'node_modules/.pg-nano')
  const schemaDir = path.join(untrackedDir, 'schema')

  let userConfig: UserConfig | undefined
  if (configFilePath) {
    log('Loading config file', configFilePath)
    const result = await bundleRequire({
      filepath: configFilePath,
    })
    userConfig = result.mod.default
  }

  const config = {
    ...userConfig,
    dev: {
      ...userConfig?.dev,
      connectionString:
        options.dsn ??
        userConfig?.dev?.connectionString ??
        'postgres://postgres:postgres@localhost:5432/postgres',
    },
    schema: {
      ...userConfig?.schema,
      include: userConfig?.schema?.include ?? ['**/*.pgsql'],
      exclude: userConfig?.schema?.exclude ?? ['**/node_modules'],
    },
    migration: {
      ...userConfig?.migration,
      allowHazards: userConfig?.migration?.allowHazards ?? [],
    },
  }

  // https://github.com/stripe/pg-schema-diff/issues/129
  config.migration.allowHazards.push('HAS_UNTRACKABLE_DEPENDENCIES' as any)

  // Enable unsafe mode for local development.
  if (config.dev.connectionString.includes('localhost')) {
    config.migration.allowHazards.push(...allMigrationHazardTypes)
  }

  return {
    root,
    configFilePath: configFilePath && path.relative(root, configFilePath),
    config,
    untrackedDir,
    schemaDir,
  }
}
