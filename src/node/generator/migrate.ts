import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { Env } from '../env.js'
import { events } from '../events.js'
import { cwdRelative } from '../util/path.js'

export async function migrate(env: Env, opts: { dryRun?: boolean } = {}) {
  const proc = pgSchemaDiff(env, opts.dryRun ? 'plan' : 'apply')

  let stdout = ''
  if (opts.dryRun) {
    proc.stdout?.on('data', data => {
      stdout += data
    })
  }

  let stderr = ''
  proc.stderr?.on('data', data => {
    stderr += data
  })

  if (env.verbose && !opts.dryRun) {
    events.emit('pg-schema-diff:apply', { proc })
  }

  await new Promise((resolve, reject) => {
    proc.on('close', resolve)
    proc.on('error', reject)
  })

  if (stderr) {
    let message = stderr

    const schemaDirRegex = new RegExp(env.schemaDir + '/[^)]+')
    if (env.verbose) {
      message = message.replace(schemaDirRegex, source => {
        const [, file, line] = fs
          .readFileSync(source, 'utf8')
          .match(/file:\/\/(.+?)#L(\d+)/)!

        return `${cwdRelative(file)}:${line}`
      })
    } else {
      const source = stderr.match(schemaDirRegex)
      const pgError = stderr.match(/\bERROR: ([\S\s]+)$/)?.[1]
      if (pgError) {
        message = pgError.trimEnd()
      }
      if (source) {
        const [, file, line] =
          fs.readFileSync(source[0], 'utf8').match(/file:\/\/(.+?)#L(\d+)/) ||
          []

        if (file && line) {
          message += `\n\n    at ${cwdRelative(file)}:${line}`
        }
      }
    }
    throw new Error(message)
  }

  return stdout
}

function pgSchemaDiff(env: Env, command: 'apply' | 'plan') {
  const applyArgs: string[] = []
  if (command === 'apply') {
    applyArgs.push(
      '--skip-confirm-prompt',
      '--allow-hazards',
      env.config.migration.allowHazards.join(','),
      '--disable-plan-validation',
    )
  }

  const pkgSpecifier = '@pg-nano/pg-schema-diff/package.json'

  // Once Vite supports import.meta.resolve, we can remove the require.resolve
  // fallback. See: https://github.com/vitejs/vite/discussions/15871
  let pkgPath: string
  if (typeof import.meta.resolve === 'function') {
    pkgPath = new URL(import.meta.resolve(pkgSpecifier)).pathname
  } else {
    pkgPath = require.resolve(pkgSpecifier)
  }

  const binaryPath = path.resolve(pkgPath, '../pg-schema-diff')

  return spawn(binaryPath, [
    command,
    '--dsn',
    env.config.dev.connectionString,
    '--schema-dir',
    env.schemaDir,
    ...applyArgs,
  ])
}
