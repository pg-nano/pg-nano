import {
  type ChildProcess,
  spawn as nodeSpawn,
  type SpawnOptions,
} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { Readable } from 'node:stream'
import { Client, sql } from 'pg-nano'
import type { UserConfig } from 'pg-nano/config'
import { events, generate, getEnv } from 'pg-nano/node'
import { select, shake, uid } from 'radashi'
import { dedent } from '../src/node/util/dedent.js'

export function spawn(
  cmd: string,
  args: string[] = [],
  opts: SpawnOptions = {},
): ChildProcess & Promise<void> {
  const proc = nodeSpawn(cmd, args, opts)
  const promise = new Promise<void>((resolve, reject) => {
    proc.on('close', resolve)
    proc.on('error', reject)
  }) as any
  Object.assign(promise, proc)
  return promise
}

export async function initPostgres() {
  const port = process.env.PGPORT || '15432'
  const proc = spawn('pg_tmp', ['-t', '-p', port])
  const stderrPromise = bufferReadable<string>(proc.stderr!, 'utf8')
  const stdout = await bufferReadable<string>(proc.stdout!, 'utf8')
  if (stdout) {
    process.env.PG_TMP_DSN = stdout
    console.log('PG_TMP_DSN = %O', stdout)
  } else {
    const stderr = await stderrPromise
    if (stderr.includes('postmaster already running')) {
      process.env.PG_TMP_DSN = `postgresql://${process.env.USER}@localhost:${port}/test`
    } else {
      console.error(stderr)
    }
  }
  await proc
}

async function bufferReadable<T extends Buffer | string>(
  readable: Readable,
  encoding?: BufferEncoding | null,
): Promise<T> {
  if (encoding) {
    readable.setEncoding(encoding)
  }
  const chunks: any[] = []
  for await (const chunk of readable) {
    chunks.push(chunk)
  }
  encoding = readable.readableEncoding
  if (encoding === null || encoding === 'binary') {
    return Buffer.concat(chunks) as T
  }
  return chunks.join('') as T
}

export async function resetPublicSchema() {
  await spawn('psql', [
    '-d',
    process.env.PG_TMP_DSN!,
    '-c',
    'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO public',
  ])
}

export function randomId() {
  return sql.id(uid(20))
}

export function addFixtures(
  fixtureDir: string,
  fixtures: Record<string, string>,
) {
  for (const [name, fixture] of Object.entries(fixtures)) {
    const file = path.join(fixtureDir, name)
    if (name.includes('/')) {
      fs.mkdirSync(path.dirname(file), { recursive: true })
    }
    fs.writeFileSync(file, fixture)
  }
}

export async function createProject(fixtures: Record<string, string>) {
  const { currentTestName } = expect.getState()
  const testId = currentTestName
    ?.replace(/\s+\>\s+/, '__')
    .replace(/\s+/g, '_')
    .replace(/[./]/g, '')

  const fixtureDir = new URL('./__fixtures__/' + testId, import.meta.url)
    .pathname

  const config: UserConfig = {
    dev: { connectionString: process.env.PG_TMP_DSN! },
  }

  fixtures['pg-nano.config.ts'] ??= dedent`
    export default ${JSON.stringify(config)}
  `

  addFixtures(fixtureDir, fixtures)
  const env = await getEnv(fixtureDir)
  const readFile = (name: string) => {
    try {
      return fs.readFileSync(path.join(fixtureDir, name), 'utf8')
    } catch (error) {
      return null
    }
  }

  const eventLog: any[][] = []
  events.emit = (...args: any[]) => {
    eventLog.push(args)
  }

  return {
    env,
    eventLog,
    async generate() {
      eventLog.length = 0
      await generate(
        env,
        select(
          Object.keys(fixtures),
          file => path.join(env.root, file),
          file => file.endsWith('.sql'),
        ),
      )
      return shake({
        'sql/schema.ts': readFile('sql/schema.ts'),
        'sql/typeData.ts': readFile('sql/typeData.ts'),
      })
    },
    async importClient<TSchema extends object>() {
      const schema = await import(path.join(fixtureDir, 'sql/schema.ts'))
      const client = new Client()
      await client.connect(config.dev.connectionString!)
      return client.withSchema<TSchema>(schema)
    },
  }
}

export { dedent }
