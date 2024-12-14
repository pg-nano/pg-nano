import { type Context, jumpgen, type JumpgenOptions } from 'jumpgen'
import type { ShallowOptions } from 'option-types'
import type { UserConfig } from 'pg-nano/config'
import { log } from './log.js'
import { Project } from './project.js'

export type Options = ShallowOptions<{
  /**
   * Partially override the config file.
   */
  config?: Partial<UserConfig>
  /**
   * When true, dynamic `import()` is used to load the config file, instead of
   * the `bundle-require` npm package. If true, changes to modules imported by
   * the config file won't be watched.
   */
  noConfigBundling?: boolean
}> &
  Omit<JumpgenOptions, 'watch'>

type Store = {
  project: Project
  configFilePath: string | null
}

type Result = [Error | null, Project]

/**
 * Automatically migrate the database schema and update the TypeScript bindings
 * when your SQL files change. This is the same as running `pg-nano dev` from
 * the command line, but without event logging enabled.
 */
export default (options: Options = {}) =>
  jumpgen('pg-nano', async (ctx: Context<Store>): Promise<Result> => {
    const { fs, store } = ctx

    const project = (store.project ??= new Project({
      ...options,
      root: ctx.root,
      readFile: fs.read,
      findSchemaFiles(cwd, include, ignore) {
        return fs.scan(include, {
          absolute: true,
          ignoreEmptyNewFiles: true,
          ignore,
          cwd,
        })
      },
    }))

    try {
      const { configFilePath, configDependencies } = await project.refresh({
        reloadEnv:
          store.configFilePath !== undefined &&
          ctx.changes.some(change => change.file === store.configFilePath),
      })

      if (configFilePath) {
        store.configFilePath = configFilePath
        fs.watch(configDependencies, {
          cause: configFilePath,
        })
      }

      await project.update({
        skipRefresh: true,
        signal: ctx.signal,
      })
    } catch (error: any) {
      if (error.code === 'MIGRATION_HAZARDS') {
        log.error(error.message)
      } else {
        log.error(error.stack)
      }
      return [error as Error, project]
    }
    return [null, project]
  })({
    ...options,
    watch: true,
  })
