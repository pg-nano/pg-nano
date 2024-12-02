import { spawn } from 'node:child_process'
import path from 'node:path'
import type { Readable } from 'node:stream'
import type { MigrationHazardType } from 'pg-nano/config'
import { resolveImport } from 'src/node/util/resolveImport.js'

export interface MigrationPlan {
  current_schema_hash: string
  statements:
    | {
        ddl: string
        timeout_ms: number
        lock_timeout_ms: number
        hazards:
          | {
              type: MigrationHazardType
              message: string
            }[]
          | null
      }[]
    | null
}

export function planSchemaMigration(options: {
  dsn: string
  schemaDir: string
}) {
  const pkgPath = resolveImport('@pg-nano/pg-schema-diff/package.json')
  const binaryPath = path.resolve(pkgPath, '../pg-schema-diff')

  const proc = spawn(binaryPath, [
    'plan',
    '--dsn',
    options.dsn,
    '--schema-dir',
    options.schemaDir,
    '--disable-plan-validation',
    '--output-format',
    'json',
  ])

  const planPromise = readableToString(proc.stdout)
  const stderrPromise = readableToString(proc.stderr)

  return new Promise<MigrationPlan>((resolve, reject) => {
    proc.on('error', reject)
    proc.on('exit', async code => {
      if (code === 0) {
        resolve(planPromise.then(plan => JSON.parse(plan)))
      } else {
        const stderr = await stderrPromise
        reject(new Error(`pg-schema-diff exited with code ${code}:\n${stderr}`))
      }
    })
  })
}

function readableToString(readable: Readable) {
  readable.setEncoding('utf8')

  return new Promise<string>(resolve => {
    let buffer = ''
    readable.on('data', chunk => {
      buffer += chunk
    })
    readable.on('end', () => {
      resolve(buffer)
    })
  })
}
