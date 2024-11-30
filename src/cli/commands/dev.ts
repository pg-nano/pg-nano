import { jumpgen } from 'jumpgen'
import {
  enableEventLogging,
  generate,
  getEnv,
  log,
  type Env,
  type EnvOptions,
  type GenerateOptions,
} from 'pg-nano/node'

type Options = EnvOptions & Omit<GenerateOptions, 'signal'>

type Store = {
  env: Env
}

const createDevGenerator = (options: Options = {}) =>
  jumpgen<Store>('pg-nano', async ctx => {
    const { fs, store } = ctx

    const { config, configDependencies } = (store.env = await getEnv(ctx.root, {
      ...options,
      reloadEnv:
        !!store.env?.configFilePath &&
        ctx.changes.some(change => change.file === store.env.configFilePath),
    }))

    fs.watch(configDependencies)

    const files = fs.scan(config.schema.include, {
      absolute: true,
      ignoreEmptyNewFiles: true,
      ignore: [
        ...config.schema.exclude,
        config.generate.pluginSqlDir,
        '**/.pg-nano/**',
      ],
    })

    log(`Found ${files.length} SQL file${files.length === 1 ? '' : 's'}`)

    await generate(store.env, files, {
      ...options,
      signal: ctx.signal,
      readFile: fs.read,
    }).catch(error => {
      if (error.code === 'MIGRATION_HAZARDS') {
        log.error(error.message)
      } else {
        log.error(error.stack)
      }
    })
  })

export default async function dev(root: string, options: Options = {}) {
  enableEventLogging(options.verbose)
  const generate = createDevGenerator(options)
  await generate({ root, watch: true })
}
