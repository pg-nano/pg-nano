import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { Client } from 'pg-nano'
import { camel } from 'radashi'
import type { Env } from './env'
import {
  introspectEnumTypes,
  introspectResultSet,
  introspectUserFunctions,
} from './introspect'
import { log } from './log'
import { parseMigrationPlan } from './parseMigrationPlan'
import { populateSchemaDir } from './schemaDir'
import { typeConversion } from './typeConversion'

export async function generate(
  client: Client,
  filePaths: string[],
  env: Env,
  signal?: AbortSignal,
) {
  log('Migrating database...')

  await populateSchemaDir(filePaths, env)

  const applyProc = diffSchemas(env, 'apply')

  let applyStderr = ''
  applyProc.stderr?.on('data', data => {
    applyStderr += data
  })

  const successRegex = /(No plan generated|Finished executing)/
  const commentRegex = /^\s+-- /

  let completed = false
  for await (const line of parseMigrationPlan(applyProc.stdout)) {
    if (line.type === 'title') {
      if (line.text === 'Complete') {
        completed = true
      } else {
        log(line.text)
      }
    } else if (line.type === 'body') {
      if (completed || successRegex.test(line.text)) {
        log.success(line.text)
      } else if (commentRegex.test(line.text)) {
        log.comment(line.text)
      } else {
        log.command(line.text)
      }
    }
  }

  await new Promise((resolve, reject) => {
    applyProc.on('close', resolve)
    applyProc.on('error', reject)
  })

  if (applyStderr) {
    throw new Error(applyStderr.replace(/.+? ERROR: /, ''))
  }

  log('Generating type definitions...')

  const [functions, enumTypes] = await Promise.all([
    introspectUserFunctions(client, signal),
    introspectEnumTypes(client, signal),
  ])

  log.eraseLine()
  log.success('Generating type definitions... done')

  const foreignTypes = ['Interval', 'Range', 'Circle', 'Point']
  const imports = new Set<string>()

  let code = ''

  for (const fn of functions) {
    const jsName = camel(fn.proname)

    const argNames = fn.proargnames?.map(name => camel(name.replace(/^p_/, '')))
    const argTypes = fn.proargtypes
      ? fn.proargtypes
          .split(' ')
          .map((typeOid, index, argTypes) => {
            let type = typeConversion[typeOid]
            if (type) {
              if (foreignTypes.includes(type)) {
                imports.add(type)
              }
            } else {
              type = 'unknown'
              log.warn(`Unknown type: ${typeOid}`)
            }
            if (argNames) {
              const jsName = argNames[index]
              const optionalToken =
                index >= argTypes.length - fn.pronargdefaults ? '?' : ''

              return `${jsName}${optionalToken}: ${type}`
            }
            return type
          })
          .join(', ')
      : ''

    const schema =
      fn.nspname !== 'public' ? `, ${JSON.stringify(fn.nspname)}` : ''

    const params =
      argNames || schema ? `, ${JSON.stringify(argNames || null)}` : ''

    if (fn.proargnames) {
      code +=
        `export declare namespace ${jsName} {\n` +
        `  export type Params = {${argTypes}}\n` +
        '}\n\n'
    }

    const TArgs = fn.proargnames ? `${jsName}.Params` : `[${argTypes}]`
    const TResult = fn.proretset
      ? await introspectResultSet(client, fn, signal).then(columns => {
          return `{${columns.map(({ name, dataTypeID }) => `${name}: ${typeConversion[dataTypeID] || 'unknown'}`).join(', ')}}`
        })
      : typeConversion[fn.prorettype] || 'unknown'

    const declare = fn.proretset ? 'declareRoutine' : 'declareScalarRoutine'
    imports.add(declare)

    const exportStmt = `export const ${jsName} = ${declare}<${TArgs}, ${TResult}>(${JSON.stringify(fn.proname)}${params}${schema})`

    code += `${exportStmt}\n\n`
  }

  code =
    `import { ${[...imports].sort().join(', ')} } from 'pg-nano'\n\n` + code

  await fs.writeFile(path.join(env.root, 'api.ts'), code.replace(/\s+$/, '\n'))
}

function diffSchemas(env: Env, command: 'apply' | 'plan') {
  const applyArgs: string[] = []
  if (command === 'apply') {
    applyArgs.push(
      '--skip-confirm-prompt',
      '--allow-hazards',
      env.config.migration.allowHazards.join(','),
      '--pre-plan-file',
      path.join(env.untrackedDir, 'pre-plan.sql'),
    )
  }

  const pgSchemaDiff = path.join(
    new URL(import.meta.resolve('@pg-nano/pg-schema-diff/package.json'))
      .pathname,
    '../pg-schema-diff',
  )

  return spawn(pgSchemaDiff, [
    command,
    '--dsn',
    env.config.dev.connectionString,
    '--schema-dir',
    env.schemaDir,
    ...applyArgs,
  ])
}
