import type { Options as BundleRequireOptions } from 'bundle-require'
import mri from 'mri'
import path from 'node:path'
import { Client } from 'pg-nano'
import { sql } from 'pg-native'
import { camel, castArrayIfExists, mapKeys } from 'radashi'
import { resolveConfig, type UserConfig } from './config/config.js'
import { findConfigFile } from './config/findConfigFile.js'
import { allMigrationHazardTypes } from './config/hazards.js'
import { debug } from './debug.js'
import { events } from './events.js'
import { log } from './log.js'
import { isLocalHost } from './util/localhost.js'

export type EnvOptions = {
  dsn?: string
  verbose?: boolean
  watch?: boolean
  /** Skip cache and reload environment */
  reloadEnv?: boolean
  /**
   * When true, dynamic `import()` is used to load the config file, instead of
   * the `bundle-require` npm package. When “config bundling” is disabled,
   * changes to modules imported by the config file aren't observed.
   */
  noConfigBundling?: boolean
}

const cache = new Map<string, Promise<Env>>()

export type Env = Awaited<ReturnType<typeof loadEnv>>

export function getEnv(cwd: string, options: EnvOptions = {}) {
  const key = JSON.stringify([cwd, options.dsn])

  let env = cache.get(key)
  if (env) {
    if (!options.reloadEnv) {
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
  let userConfigDependencies: string[] = []

  if (configFilePath) {
    events.emit('load-config', { configFilePath })
    if (options.noConfigBundling) {
      const configModule = await import(configFilePath)
      userConfig = configModule.default
    } else {
      const requireOptions: Partial<BundleRequireOptions> = {}
      if (process.env.BUNDLE_REQUIRE_OPTIONS) {
        const { default: stringArgv } = await import('string-argv')
        const rawOptions = stringArgv(process.env.BUNDLE_REQUIRE_OPTIONS)
        const { '': _, ...parsedOptions } = mapKeys(mri(rawOptions), key =>
          camel(key),
        )
        if (debug.enabled) {
          log('Using BUNDLE_REQUIRE_OPTIONS →', parsedOptions)
        }
        parsedOptions.external = castArrayIfExists(parsedOptions.external)
        parsedOptions.noExternal = castArrayIfExists(parsedOptions.noExternal)
        Object.assign(requireOptions, parsedOptions)
      }
      const { bundleRequire } = await import('bundle-require')
      const result = await bundleRequire({
        ...requireOptions,
        filepath: configFilePath,
      })
      userConfig = result.mod.default
      userConfigDependencies = result.dependencies.map(dep => path.resolve(dep))
    }
  }

  const config = resolveConfig(root, userConfig, options)

  // https://github.com/stripe/pg-schema-diff/issues/129
  config.migration.allowHazards.push('HAS_UNTRACKABLE_DEPENDENCIES' as any)

  // Enable unsafe mode for local development.
  if (isLocalHost(config.dev.connection.host)) {
    config.migration.allowHazards.push(...allMigrationHazardTypes)
  } else {
    throw new Error('Non-local databases are not currently supported')
  }

  let client: Promise<Client> | undefined

  return {
    root,
    configFilePath: configFilePath && path.relative(root, configFilePath),
    configDependencies: userConfigDependencies,
    config,
    untrackedDir,
    schemaDir,
    verbose: options.verbose,
    get client() {
      return (client ??= (async () => {
        events.emit('connecting', config.dev.connection)

        const client = new Client({
          debug: true,
          maxRetries: 2,
          postConnectQuery: sql`
            SET client_min_messages = ${sql.unsafe(process.env.TEST ? 'NOTICE' : 'WARNING')};
            SET check_function_bodies = OFF;
          `,
        })

        try {
          await client.connect(config.dev.connectionString)
        } catch (error: any) {
          if (!/database ".+?" does not exist/.test(error.message)) {
            throw error
          }

          const { dbname } = config.dev.connection
          events.emit('create-database', dbname)

          await client.connect({
            application_name: 'pg-nano',
            ...config.dev.connection,
            dbname: 'postgres',
          })

          await client.query(sql`
            CREATE DATABASE ${sql.id(dbname)}
          `)

          await client.close()
          await client.connect(config.dev.connectionString)
        }

        return client
      })())
    },
    async close() {
      return client?.then(client => client.close())
    },
  }
}
