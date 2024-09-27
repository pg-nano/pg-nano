import { readFileSync } from 'node:fs'
import { defineConfig } from 'tsup'

const pkgJson = JSON.parse(readFileSync('../../package.json', 'utf-8'))

export default defineConfig({
  entry: {
    index: 'index.ts',
    config: 'config/config.ts',
    plugin: 'config/plugin.ts',
  },
  outDir: '../../dist/node',
  format: ['esm'],
  external: ['pg-native', 'pg-nano', ...Object.keys(pkgJson.dependencies)],
  treeshake: 'smallest',
  minifySyntax: !process.env.DEV,
  tsconfig: '../../tsconfig.json',
  dts: !process.env.DEV,
})
