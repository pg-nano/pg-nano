import { watch } from 'chokidar'
import { gray, strikethrough } from 'kleur/colors'
import { statSync } from 'node:fs'
import path from 'node:path'
import { Client } from 'pg-nano'
import { debounce, select } from 'radashi'
import { type EnvOptions, getEnv } from '../env'
import { generate } from '../generate'
import { log } from '../log'

type Options = EnvOptions & {}

export default async function dev(cwd: string, options: Options = {}) {
  const env = await getEnv(cwd, options)

  log('Connecting to database', fuzzPassword(env.config.dev.connectionString))
  const client = new Client()
  await client.connect(env.config.dev.connectionString)

  const watcher = watch(env.config.schema.include, {
    cwd: env.root,
    ignored: [...env.config.schema.exclude, '**/.pg-nano/**'],
  })

  if (env.configFilePath) {
    watcher.add(env.configFilePath)
  }

  let controller = new AbortController()

  const regenerate = debounce({ delay: 400 }, () => {
    controller.abort()
    controller = new AbortController()

    const sqlRegex = /\.(p|sp|pg)?sql$/
    const filePaths = Object.entries(watcher.getWatched()).flatMap(
      ([dir, files]) =>
        select(
          files,
          file => path.join(env.root, dir, file),
          file => sqlRegex.test(file),
        ),
    )

    generate(client, filePaths, env, controller.signal).catch(error => {
      log.error(error.stack)
    })
  })

  const sqlFiles = new Set<string>()

  watcher.on('all', (event, path) => {
    if (event === 'addDir' || event === 'unlinkDir') {
      return
    }
    if (path === env.configFilePath) {
      if (event === 'change') {
        client.close()
        watcher.close()

        log.magenta('Config changed, refreshing...')
        dev(cwd, { ...options, forceReload: true })
      }
    } else {
      const skipped = event === 'add' && statSync(path).size === 0
      log.magenta(
        event,
        skipped ? gray(strikethrough(path) + ' (empty)') : path,
      )
      if (event === 'add') {
        sqlFiles.add(path)
      } else if (event === 'unlink') {
        sqlFiles.delete(path)
      } else if (event === 'change') {
      }
      if (!skipped) {
        regenerate()
      }
    }
  })
}

function fuzzPassword(connectionString: string) {
  return connectionString.replace(
    /\bpostgres:\/\/(\w+):[^@]+@/g,
    'postgres://$1:***@',
  )
}
