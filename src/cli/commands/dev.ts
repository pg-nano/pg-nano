import { gray, strikethrough } from 'kleur/colors'
import { statSync } from 'node:fs'
import path from 'node:path'
import {
  enableEventLogging,
  generate,
  getEnv,
  log,
  type EnvOptions,
  type GenerateOptions,
} from 'pg-nano/node'
import { debounce, select } from 'radashi'

type Options = EnvOptions & Omit<GenerateOptions, 'signal'>

export default async function dev(cwd: string, options: Options = {}) {
  enableEventLogging(options.verbose)
  const env = await getEnv(cwd, {
    ...options,
    watch: true,
  })

  const watcher = env.watcher!

  let controller = new AbortController()

  const regenerate = debounce({ delay: 400 }, () => {
    controller.abort()
    controller = new AbortController()

    const sqlRegex = /\.(p|pg)?sql$/
    const filePaths = Object.entries(watcher.getWatched()).flatMap(
      ([dir, files]) =>
        select(
          files,
          file => path.join(env.root, dir, file),
          file => sqlRegex.test(file),
        ),
    )

    generate(env, filePaths, {
      ...options,
      signal: controller.signal,
    }).catch(error => {
      log.error(error.stack)
    })
  })

  let filesAdded = 0
  watcher.once('ready', () => {
    log(`Found ${filesAdded} SQL file${filesAdded === 1 ? '' : 's'}`)
    filesAdded = -1
  })

  watcher.on('all', (event, file) => {
    if (event === 'addDir' || event === 'unlinkDir') {
      return
    }
    const filePath = path.join(watcher.options.cwd!, file)
    if (env.configDependencies.includes(filePath)) {
      if (event === 'change') {
        watcher.close()

        log.magenta('Config changed, refreshing...')
        dev(cwd, { ...options, reloadEnv: true })
      }
    } else {
      const skipped = event === 'add' && statSync(file).size === 0
      if (filesAdded < 0) {
        log.magenta(
          event,
          skipped ? gray(strikethrough(file) + ' (empty)') : file,
        )
      } else if (event === 'add') {
        filesAdded++
      }
      if (!skipped) {
        regenerate()
      }
    }
  })
}
