import {
  type ChildProcess,
  spawn as nodeSpawn,
  type SpawnOptions,
} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { Readable } from 'node:stream'
import type { ShallowOptions } from 'option-types'
import { Client } from 'pg-nano'
import { events, Project } from 'pg-nano/node'
import { shake } from 'radashi'
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

export declare namespace TestProject {
  interface Options extends Omit<Project.Options, 'root'> {
    fixtures: Record<string, string>
    plugins?: string[] | undefined
  }
}

export class TestProject extends Project {
  eventLog: any[][] = []
  root: string
  dsn: string

  constructor(options: TestProject.Options) {
    const dsn = process.env.PG_TMP_DSN!
    const name = currentTestName()
    const fixtureDir = new URL('./__fixtures__/' + name, import.meta.url)
      .pathname

    if (options.plugins) {
      options.fixtures['pg-nano.config.ts'] ??= dedent`
        ${options.plugins
          .map((plugin, index) => {
            return `import $${index} from '${plugin}'`
          })
          .join('\n')}
        export default {plugins: [${options.plugins.map((_, index) => `$${index}()`).join(', ')}]}
      `
    }

    // Write fixtures to the file system.
    addFixtures(fixtureDir, options.fixtures)

    super({
      ...options,
      root: fixtureDir,
      noConfigBundling: true,
      config: {
        ...options.config,
        dev: {
          ...options.config?.dev,
          connectionString: dsn,
        },
      },
    })

    this.root = fixtureDir
    this.dsn = dsn

    events.emit = (...args: any[]) => {
      this.eventLog.push(args)
      return true
    }
  }

  override async update(
    options?: ShallowOptions<{
      skipRefresh?: boolean
      noEmit?: boolean
      signal?: AbortSignal
    }>,
  ): Promise<void> {
    this.eventLog.length = 0
    await super.update(options)
  }

  readFile(name: string) {
    try {
      return fs.readFileSync(path.join(this.root, name), 'utf8')
    } catch (error) {
      return null
    }
  }

  readGeneratedFiles() {
    return shake({
      'sql/schema.ts': this.readFile('sql/schema.ts'),
      'sql/typeData.ts': this.readFile('sql/typeData.ts'),
    })
  }

  writeFile(name: string, content: string) {
    fs.writeFileSync(path.join(this.root, name), content)
  }

  async importClient<TSchema extends object>() {
    const schema = await import(path.join(this.root, 'sql/schema.ts'))
    const client = new Client()
    await client.connect(this.dsn)
    return client.withSchema<TSchema>(schema)
  }
}

export { dedent }
