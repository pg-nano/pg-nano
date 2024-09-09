import { watch } from 'chokidar'
import { gray, strikethrough } from 'kleur/colors'
import { statSync } from 'node:fs'
import path from 'node:path'
import { debounce, select } from 'radashi'
import { type EnvOptions, getEnv } from '../env'
import { generate } from '../generate'
import { log } from '../log'

type Options = EnvOptions & {
  refreshPluginRole?: boolean
}

export default async function dev(cwd: string, options: Options = {}) {
  const env = await getEnv(cwd, options)

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
      refreshPluginRole: options.refreshPluginRole && !options.reloadEnv,
      signal: controller.signal,
    }).catch(error => {
      log.error(error.stack)
    })
  })

  watcher.on('all', (event, path) => {
    if (event === 'addDir' || event === 'unlinkDir') {
      return
    }
    if (path === env.configFilePath) {
      if (event === 'change') {
        watcher.close()

        log.magenta('Config changed, refreshing...')
        dev(cwd, { ...options, reloadEnv: true })
      }
    } else {
      if (path.startsWith(env.config.typescript.pluginSqlDir)) {
        // Ignore changes to plugin-generated SQL files.
        return
      }
      const skipped = event === 'add' && statSync(path).size === 0
      log.magenta(
        event,
        skipped ? gray(strikethrough(path) + ' (empty)') : path,
      )
      if (!skipped) {
        regenerate()
      }
    }
  })
}
