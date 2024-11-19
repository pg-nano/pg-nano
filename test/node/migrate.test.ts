import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { select } from 'radashi'
import { globSync } from 'tinyglobby'
import { migrate } from '../../src/node/generator/migrate.js'
import {
  bufferReadable,
  createProject,
  dedent,
  resetPublicSchema,
  spawn,
} from '../util.js'

const cwd = join(__dirname, '__fixtures__')

describe('migrate', () => {
  beforeEach(async () => {
    await resetPublicSchema()
  })

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

      let migrationPlan = ''
      await project.generate({
        noEmit: true,
        async preMigrate() {
          migrationPlan = await migrate(project.env, { dryRun: true })
          if (/No plan generated/i.test(migrationPlan)) {
            migrationPlan = ''
          }
        },
      })

      await expect(
        '-- noqa: disable=all\n' +
          select(
            project.eventLog,
            event => dedent(event[1].query),
            event => event[0] === 'prepare:mutation',
          ).join('\n') +
          '\n' +
          migrationPlan,
      ).toMatchFileSnapshot(
        join(__dirname, '__snapshots__', caseName + '.diff.sql'),
      )

      await expect(await dumpSchema()).toMatchFileSnapshot(
        join(__dirname, '__snapshots__', caseName + '.dump.sql'),
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
