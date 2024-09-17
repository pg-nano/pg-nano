import fs from 'node:fs'

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))

export default {
  commit: pkg.name + '@%s',
  tag: pkg.name === 'pg-nano' ? 'v%s' : pkg.name + '@%s',
}
