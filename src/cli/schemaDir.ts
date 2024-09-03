import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { group, noop } from 'radashi'
import type { Env } from './env'

export async function populateSchemaDir(filePaths: string[], env: Env) {
  await fs.rm(env.schemaDir, { recursive: true, force: true }).catch(noop)
  await fs.mkdir(env.schemaDir, { recursive: true }).catch(noop)

  const { pre: prePlanFiles, rest: schemaFiles } = group(filePaths, file => {
    const name = path.basename(file)
    return name[0] === '!' ? 'pre' : 'rest'
  })

  await fs.writeFile(
    path.join(env.untrackedDir, 'pre-plan.sql'),
    'SET check_function_bodies = off;\n\n' +
      (prePlanFiles
        ? (
            await Promise.all(
              prePlanFiles.map(file => fs.readFile(file, 'utf8')),
            )
          ).join('\n\n')
        : ''),
  )

  if (schemaFiles) {
    await Promise.all(
      schemaFiles.map(async file => {
        const symlinkPath = path.join(
          env.schemaDir,
          path.basename(file, path.extname(file)) +
            '.' +
            md5Hash(file).slice(0, 8) +
            '.sql',
        )

        await fs.unlink(symlinkPath).catch(noop)
        await fs.symlink(path.relative(env.schemaDir, file), symlinkPath)
      }),
    )
  }
}

function md5Hash(input: string): string {
  return crypto.createHash('md5').update(input).digest('hex')
}
