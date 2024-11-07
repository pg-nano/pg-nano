import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import './inspect.js'
import { initPostgres, spawn } from './util.js'

const epgRootDir = resolve('test/ephemeralpg')
const epgBuildDir = join(epgRootDir, 'build')

if (!existsSync(epgRootDir)) {
  console.log('Installing ephemeralpg...')
  await spawn(
    'git',
    ['clone', 'https://github.com/eradman/ephemeralpg', '--depth', '1'],
    {
      cwd: 'test',
      stdio: 'inherit',
      env: process.env,
    },
  )
  // Run make install
  await spawn('make', ['install'], {
    cwd: epgRootDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      PREFIX: epgBuildDir,
    },
  })
}

const epgBinDir = join(epgBuildDir, 'bin')
process.env.PATH = `${epgBinDir}:${process.env.PATH}`

await initPostgres()
