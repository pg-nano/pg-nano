import type { UserConfig } from '@pg-nano/config'
import { bundleRequire } from 'bundle-require'
import path from 'node:path'
import { Client, sql } from 'pg-nano'
import { allMigrationHazardTypes } from '../config/hazards'
import { findConfigFile } from './findConfigFile'
import { log } from './log'

export type EnvOptions = {
  dsn?: string
  verbose?: boolean
  /** Skip cache and reload environment */
  forceReload?: boolean
}

const cache = new Map<string, Promise<Env>>()

export type Env = Awaited<ReturnType<typeof loadEnv>>

export function getEnv(cwd: string, options: EnvOptions = {}) {
  const key = JSON.stringify([cwd, options.dsn])

  let env = cache.get(key)
  if (env) {
    if (!options.forceReload) {
      return env
    }
    env.then(env => env.close())
  }

  env = loadEnv(cwd, options)
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
    verbose: options.verbose,
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
    typescript: {
      ...userConfig?.typescript,
      outFile: path.resolve(
        root,
        userConfig?.typescript?.outFile ?? 'sql/api.ts',
      ),
    },
  }

  // https://github.com/stripe/pg-schema-diff/issues/129
  config.migration.allowHazards.push('HAS_UNTRACKABLE_DEPENDENCIES' as any)

  // Enable unsafe mode for local development.
  if (config.dev.connectionString.includes('localhost')) {
    config.migration.allowHazards.push(...allMigrationHazardTypes)
  } else {
    throw new Error('Non-local databases are not currently supported')
  }

  let client: Promise<Client> | undefined

  return {
    root,
    configFilePath: configFilePath && path.relative(root, configFilePath),
    config,
    untrackedDir,
    schemaDir,
    get client() {
      return (client ??= (async () => {
        log('Connecting to database', fuzzPassword(config.dev.connectionString))
        const client = new Client()
        await client.connect(config.dev.connectionString)
        await client.query(sql.unsafe('SET client_min_messages TO WARNING;'))
        return client
      })())
    },
    async close() {
      return client?.then(client => client.close())
    },
  }
}

function fuzzPassword(connectionString: string) {
  return connectionString.replace(
    /\bpostgres:\/\/(\w+):[^@]+@/g,
    'postgres://$1:***@',
  )
}
