import copy from 'esbuild-plugin-copy'
import licenses from 'esbuild-plugin-license'
import { mkdirSync, writeFileSync } from 'node:fs'
import { defineConfig } from 'tsup'

const outDir = '../../dist/node_modules/pg-native'

// Avoid issue with esbuild-plugin-license
mkdirSync(outDir, { recursive: true })

export default defineConfig({
  entry: { index: 'src/index.ts' },
  outDir,
  esbuildPlugins: [
    licenses(),
    copy({
      assets: {
        from: 'LICENSE',
        to: 'LICENSE',
      },
    }),
  ],
  plugins: [
    {
      name: 'create-package.json',
      buildEnd() {
        const pkgJson = {
          name: 'pg-native',
          private: true,
          type: 'module',
          exports: {
            '.': {
              types: './index.d.ts',
              default: './index.js',
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
  format: ['esm'],
  external: ['debug', '@pg-nano/libpq'],
  treeshake: 'smallest',
  minifySyntax: !process.env.DEV,
  dts: !process.env.DEV,
})
