import {
  type ChildProcess,
  spawn as nodeSpawn,
  type SpawnOptions,
} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { Readable } from 'node:stream'
import { Client } from 'pg-nano'
import type { UserConfig } from 'pg-nano/config'
import { events, generate, getEnv } from 'pg-nano/node'
import { select, shake } from 'radashi'
import type { GenerateOptions } from '../src/node/generator/generate.js'
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

export async function bufferReadable<T extends Buffer | string>(
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
    process.env.PG_TMP_DSN!,
    '-c',
    'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO public',
  ])
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

export function currentTestName() {
  const { currentTestName } = expect.getState()
  if (!currentTestName) {
    throw new Error('No current test name')
  }
  return currentTestName
    .replace(/\s+\>\s+/, '__')
    .replace(/\s+(-\s+)?/g, '_')
    .replace(/[./]/g, '+')
}

export type Project = Awaited<ReturnType<typeof createProject>>

export async function createProject(
  fixtures: Record<string, string>,
  config?: Partial<Omit<UserConfig, 'plugins'>> & {
    plugins?: string[] | undefined
  },
) {
  const name = currentTestName()
  const fixtureDir = new URL('./__fixtures__/' + name, import.meta.url).pathname

  const connectionString = process.env.PG_TMP_DSN!
  const plugins = config?.plugins ?? []

  config = {
    ...config,
    dev: { connectionString },
    plugins: undefined,
  }

  fixtures['pg-nano.config.ts'] ??= dedent`
    ${plugins.map((plugin, index) => `import $${index} from '${plugin}'`).join('\n')}
    const config = ${JSON.stringify(config)}
    export default {...config, plugins: [${plugins.map((_, index) => `$${index}()`).join(', ')}]}
  `

  // Write fixtures to the file system.
  addFixtures(fixtureDir, fixtures)

  // Load the environment, including the config file.
  const env = await getEnv(fixtureDir, {
    noConfigBundling: true,
    verbose: true,
  })

  const eventLog: any[][] = []
  events.emit = (...args: any[]) => {
    eventLog.push(args)
    return true
  }

  const readFile = (name: string) => {
    try {
      return fs.readFileSync(path.join(fixtureDir, name), 'utf8')
    } catch (error) {
      return null
    }
  }

  return {
    env,
    eventLog,
    async generate(options?: GenerateOptions) {
      eventLog.length = 0
      await generate(
        env,
        select(
          Object.keys(fixtures),
          file => path.join(env.root, file),
          file => file.endsWith('.sql'),
        ),
        options,
      )
    },
    writeFile(name: string, content: string) {
      fs.writeFileSync(path.join(fixtureDir, name), content)
    },
    get generatedFiles() {
      return shake({
        'sql/schema.ts': readFile('sql/schema.ts'),
        'sql/typeData.ts': readFile('sql/typeData.ts'),
      })
    },
    async importClient<TSchema extends object>() {
      const schema = await import(path.join(fixtureDir, 'sql/schema.ts'))
      const client = new Client()
      await client.connect(connectionString)
      return client.withSchema<TSchema>(schema)
    },
  }
}

export { dedent }
