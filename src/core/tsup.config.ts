import licenses from 'esbuild-plugin-license'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'tsup'

const outDir = '../../dist'
const pkgJson = JSON.parse(readFileSync('../../package.json', 'utf-8'))

export default defineConfig({
  entry: {
    'pg-nano': 'mod.ts',
  },
  esbuildPlugins: [licenses()],
  // plugins: [
  //   {
  //     name: 'create-package.json',
  //     buildEnd() {
  //       const pkgJson = {
  //         name: 'pg-nano',
  //         private: true,
  //         type: 'module',
  //         exports: pkgJson.exports,
  //       }

  //       writeFileSync(
  //         `${outDir}/package.json`,
  //         JSON.stringify(pkgJson, null, 2),
  //       )
  //     },
  //   },
  // ],
  outDir,
  format: ['esm'],
  external: ['pg-native', ...Object.keys(pkgJson.dependencies)],
  treeshake: 'smallest',
  minifySyntax: !process.env.DEV,
  tsconfig: '../../tsconfig.json',
  dts: true,
})
