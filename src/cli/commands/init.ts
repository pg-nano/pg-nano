import fs from 'node:fs'
import path from 'node:path'
import { log } from '../log'
import { dedent } from '../util/dedent'

const configTemplate = dedent`
  import { defineConfig } from 'pg-nano/config'

  export default defineConfig({
    dev: {
      connectionString: 'postgres://postgres:postgres@localhost:5432/postgres',
    },
    schema: {
      include: ['**/*.pgsql'],
    },
    typescript: {
      outFile: 'sql/api.ts',
    },
  })
`

export default async function init(cwd: string) {
  const configPath = path.join(cwd, 'pg-nano.ts')

  if (fs.existsSync(configPath)) {
    log.warn('pg-nano.ts already exists. Skipping initialization.')
  } else {
    fs.writeFileSync(configPath, configTemplate + '\n')
    log.success('Created', './pg-nano.ts')
  }
}
