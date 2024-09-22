import licenses from 'esbuild-plugin-license'
import { writeFileSync } from 'node:fs'
import { defineConfig } from 'tsup'

const outDir = '../../dist'

export default defineConfig({
  entry: {
    'pg-nano': 'mod.ts',
  },
  esbuildPlugins: [licenses()],
  plugins: [
    {
      name: 'create-package.json',
      buildEnd() {
        const pkgJson = {
          name: 'pg-nano',
          // version: JSON.parse(readFileSync('../../package.json', 'utf-8'))
          //   .version,
          private: true,
          type: 'module',
          exports: {
            '.': {
              types: 'pg-nano.d.ts',
              default: 'pg-nano.js',
            },
            './config': {
              types: 'pg-nano/config.d.ts',
              default: 'pg-nano/config.js',
            },
            './plugin': {
              types: 'pg-nano/plugin.d.ts',
              default: 'pg-nano/plugin.js',
            },
          },
        }

        writeFileSync(
          `${outDir}/package.json`,
          JSON.stringify(pkgJson, null, 2),
        )
      },
    },
  ],
  outDir,
  format: ['esm'],
  external: ['pg-native', 'debug'],
  treeshake: 'smallest',
  minifySyntax: !process.env.DEV,
  tsconfig: '../../tsconfig.json',
  dts: !process.env.DEV,
})
