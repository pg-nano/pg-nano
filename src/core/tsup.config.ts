import licenses from 'esbuild-plugin-license'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'tsup'

const outDir = '../../dist'
const pkgJson = JSON.parse(readFileSync('../../package.json', 'utf-8'))

export default defineConfig({
  entry: {
    'pg-nano': 'mod.ts',
  },
  outDir,
  format: ['esm'],
  external: ['pg-native', ...Object.keys(pkgJson.dependencies)],
  treeshake: 'smallest',
  minifySyntax: !process.env.DEV,
  tsconfig: '../../tsconfig.json',
  dts: !process.env.DEV,
  esbuildPlugins: [licenses()],
})
