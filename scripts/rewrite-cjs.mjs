import mri from 'mri'
import fs from 'node:fs'
import path from 'node:path'
import spawn from 'tinyspawn'

const argv = mri(process.argv.slice(2), {
  boolean: ['force'],
})

let packages = fs
  .readdirSync('packages')
  .filter(dir => /^(libpq|(pg|postgres)-)/.test(dir))

if (argv._.length > 0) {
  packages = packages.filter(dir => argv._.includes(dir))
}

packages = packages.map(dir => path.join('packages', dir))

if (!argv.force) {
  for (const dir of packages) {
    const status = await spawn('git status --porcelain', { cwd: dir })
    if (status.stdout.trim()) {
      console.error(dir, 'has uncommitted changes')
      process.exit(1)
    }
  }
}

for (const dir of packages) {
  console.log(dir)
  await spawn('pnpm', ['cjstoesm', 'index.js'], {
    cwd: dir,
    stdio: 'inherit',
  })
}
