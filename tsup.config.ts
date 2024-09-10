import copy from 'esbuild-plugin-copy'
import licenses from 'esbuild-plugin-license'
import { defineConfig, type Options } from 'tsup'

const commonOptions = {
  format: ['esm'],
  external: ['pg-native', 'pg-nano', 'debug'],
  minifySyntax: !process.env.DEV,
  dts: !process.env.DEV,
} satisfies Options

export default defineConfig([
  {
    ...commonOptions,
    entry: {
      'pg-nano': 'src/core/mod.ts',
      'pg-nano/config': 'src/config/config.ts',
    },
    splitting: false,
    esbuildPlugins: [
      copy({
        assets: {
          from: 'packages/pg-native/package.json',
          to: 'node_modules/pg-native',
        },
      }),
    ],
  },
  {
    ...commonOptions,
    entry: { plugin: 'src/plugin/plugin.ts' },
    outDir: 'dist/node_modules/@pg-nano/plugin',
    esbuildPlugins: [
      copy({
        assets: {
          from: 'src/plugin/package.json',
          to: '.',
        },
      }),
    ],
  },
  {
    ...commonOptions,
    entry: { main: 'src/cli/main.ts' },
    outDir: 'dist/pg-nano/cli',
    dts: false,
  },
  {
    ...commonOptions,
    entry: { index: 'packages/pg-native/src/index.ts' },
    outDir: 'dist/node_modules/pg-native',
    esbuildPlugins: getProductionEsbuildPlugins(),
  },
])

function getProductionEsbuildPlugins() {
  if (process.env.DEV) {
    return []
  }
  return [
    licenses(),
    copy({
      assets: [
        {
          from: 'packages/pg-native/LICENSE',
          to: '.',
        },
      ],
    }),
  ]
}
