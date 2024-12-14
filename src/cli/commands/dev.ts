import type { ShallowOptions } from 'option-types'
import dev, { type Options as DevOptions } from 'pg-nano/dev'
import { enableEventLogging } from 'pg-nano/node'

export type Options = DevOptions &
  ShallowOptions<{
    /**
     * Enable verbose logging.
     */
    verbose?: boolean
  }>

export default async (options: Options) => {
  enableEventLogging(options.verbose)
  await dev(options)
}
