import fs from 'node:fs'
import path from 'node:path'
import { log } from '../log'
import { dedent } from '../util/dedent'
import { cwdRelative } from '../util/path.js'

const configTemplate = dedent`
  import { defineConfig } from 'pg-nano/config'

  export default defineConfig({
    dev: {
      connection: {},
    },
    schema: {
      include: ['**/*.pgsql'],
    },
    generate: {
      outFile: 'sql/schema.ts',
    },
  })
`

export default async function init(cwd: string) {
  const configPath = path.join(cwd, 'pg-nano.config.ts')

  if (fs.existsSync(configPath)) {
    log.warn(
      '%s already exists. Skipping initialization.',
      cwdRelative(configPath),
    )
  } else {
    fs.writeFileSync(configPath, configTemplate + '\n')
    log.success('Created', cwdRelative(configPath))
  }
}
