import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { camel, pascal } from 'radashi'
import type { Env } from './env'
import {
  introspectEnumTypes,
  introspectResultSet,
  introspectUserFunctions,
  introspectUserTypes,
} from './introspect'
import { log } from './log'
import { parseMigrationPlan } from './parseMigrationPlan'
import { prepareForMigration } from './prepare'
import { typeConversion } from './typeConversion'
import { dedent } from './util/dedent'

export async function generate(
  env: Env,
  filePaths: string[],
  signal?: AbortSignal,
) {
  const client = await env.client
  const postMigration = await prepareForMigration(filePaths, env)

  log('Migrating database...')
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
    throw new Error(applyStderr)
  }

  await postMigration()

  log('Generating type definitions...')

  const [functions, enumTypes, userTypes] = await Promise.all([
    introspectUserFunctions(client, signal),
    introspectEnumTypes(client, signal),
    introspectUserTypes(client, signal),
  ])

  const foreignTypeRegex = /\b(Interval|Range|Circle|Point)\b/
  const imports = new Set<string>()

  let code = ''

  const extendedTypeConversion = { ...typeConversion }
  const convertTypeOid = (typeOid: number) => {
    let type = extendedTypeConversion[typeOid]
    if (type) {
      const match = type.match(foreignTypeRegex)
      if (match) {
        imports.add('type ' + match[1])
      }
    } else {
      type = 'unknown'
      log.warn(`Unknown type: ${typeOid}`)
    }
    return type
  }

  for (const type of enumTypes) {
    const jsName = pascal(type.typname)
    extendedTypeConversion[type.oid] = jsName
    extendedTypeConversion[type.typarray] = jsName + '[]'

    code += dedent`
      export type ${jsName} = ${type.labels.map(label => JSON.stringify(label)).join(' | ')}\n\n
    `
  }

  for (const type of userTypes) {
    const jsName = pascal(type.typname)
    extendedTypeConversion[type.oid] = jsName
    extendedTypeConversion[type.typarray] = jsName + '[]'

    code += dedent`
      export interface ${jsName} {
        ${type.fields.map(field => `${field.attname}: ${convertTypeOid(field.atttypid)}`).join('\n')}
      }\n\n
    `
  }

  for (const fn of functions) {
    const jsName = camel(fn.proname)
    console.log(jsName, fn)

    const argNames = fn.proargnames?.map(name => camel(name.replace(/^p_/, '')))
    const argTypes = fn.proargtypes
      .map((typeOid, index, argTypes) => {
        if (argNames) {
          const jsName = argNames[index]
          const optionalToken =
            index >= argTypes.length - fn.pronargdefaults ? '?' : ''

          return `${jsName}${optionalToken}: ${convertTypeOid(typeOid)}`
        }
        return convertTypeOid(typeOid)
      })
      .join(', ')

    const schema =
      fn.nspname !== 'public' ? `, ${JSON.stringify(fn.nspname)}` : ''

    const params =
      argNames || schema ? `, ${JSON.stringify(argNames || null)}` : ''

    const TParams = argNames ? `{${argTypes}}` : `[${argTypes}]`
    const TResult = fn.proretset
      ? await introspectResultSet(client, fn, signal).then(columns => {
          return `{${columns.map(({ name, dataTypeID }) => `${name}: ${convertTypeOid(dataTypeID)}`).join(', ')}}`
        })
      : convertTypeOid(fn.prorettype)

    code += dedent`
      export declare namespace ${jsName} {
        export type Params = ${TParams}
        export type Result = ${TResult}
      }\n\n
    `

    const declare = fn.proretset ? 'declareRoutine' : 'declareScalarRoutine'
    imports.add(declare)

    code += dedent`
      export const ${jsName} = ${declare}<${jsName}.Params, ${jsName}.Result>(${JSON.stringify(fn.proname)}${params}${schema})\n\n
    `
  }

  code = dedent`
    import { ${[...imports].sort().join(', ')} } from 'pg-nano'

    ${code}
  `

  fs.writeFileSync(path.join(env.root, 'api.ts'), code.replace(/\s+$/, '\n'))

  // log.eraseLine()
  log.success('Generating type definitions... done')
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
      '--pre-apply-file',
      path.join(env.untrackedDir, 'pre-apply.sql'),
      '--disable-plan-validation',
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
