import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { Env } from '../env.js'
import { events } from '../events.js'
import { cwdRelative } from '../util/path.js'

export async function migrate(env: Env) {
  const proc = pgSchemaDiff(env, 'apply')

  let stderr = ''
  proc.stderr?.on('data', data => {
    stderr += data
  })

  if (env.verbose) {
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
}

function pgSchemaDiff(env: Env, command: 'apply' | 'plan') {
  const applyArgs: string[] = []
  if (command === 'apply') {
    // const prePlanFile = path.join(env.untrackedDir, 'pre-plan.sql')
    // fs.writeFileSync(prePlanFile, 'SET check_function_bodies = off;')

    applyArgs.push(
      '--skip-confirm-prompt',
      '--allow-hazards',
      env.config.migration.allowHazards.join(','),
      '--disable-plan-validation',
      // '--pre-plan-file',
      // prePlanFile,
    )
  }

  const binaryPath = path.join(
    new URL(import.meta.resolve('@pg-nano/pg-schema-diff/package.json'))
      .pathname,
    '../pg-schema-diff',
  )

  return spawn(binaryPath, [
    command,
    '--dsn',
    env.config.dev.connectionString,
    '--schema-dir',
    env.schemaDir,
    ...applyArgs,
  ])
}
