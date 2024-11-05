import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { globSync } from 'tinyglobby'
import { bufferReadable, createProject, spawn } from '../util.js'

const cwd = join(__dirname, '__fixtures__')

describe('migrate', () => {
  for (const beforeFile of globSync('**/before.sql', { cwd })) {
    const afterFile = beforeFile.replace('before', 'after')
    const caseName = dirname(beforeFile)

    test(caseName, async () => {
      const project = await createProject({
        'sql/schema.sql': readFileSync(join(cwd, beforeFile), 'utf8'),
      })

      await project.generate({ noEmit: true })

      project.writeFile(
        'sql/schema.sql',
        readFileSync(join(cwd, afterFile), 'utf8'),
      )

      await project.generate({ noEmit: true })

      expect(await dumpSchema()).toMatchFileSnapshot(
        join(__dirname, '__snapshots__', caseName + '.sql'),
      )
    })
  }
})

async function dumpSchema() {
  const command = spawn('pg_dump', [
    '--schema-only',
    '--no-comments',
    '--no-owner',
    '--dbname',
    process.env.PG_TMP_DSN!,
  ])
  const dump = await bufferReadable<string>(command.stdout!, 'utf8')
  return (
    '-- noqa: disable=all\n' +
    dump
      .replace(/^[\S\s]*?(\nCREATE)/, '$1') // Remove everything before the first CREATE.
      .replace(/^--.*\n/gm, '') // Remove comments.
      .replace(/^\n\n+/gm, '\n') // Collapse multiple blank lines.
  )
}
