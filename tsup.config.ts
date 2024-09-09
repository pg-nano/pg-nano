import copy from 'esbuild-plugin-copy'
import licenses from 'esbuild-plugin-license'
import { defineConfig, type Options } from 'tsup'

const commonOptions = {
  format: ['esm'],
  external: ['pg-native', 'pg-nano', 'debug'],
  minifySyntax: !process.env.DEV,
} satisfies Options

export default defineConfig([
  {
    ...commonOptions,
    entry: {
      'pg-nano': 'src/core/mod.ts',
      'pg-nano/config': 'src/config/config.ts',
      'pg-nano/plugin': 'src/plugin/plugin.ts',
    },
    experimentalDts: true,
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
    entry: {
      cli: 'src/cli/main.ts',
    },
    outDir: 'dist/pg-nano',
  },
  {
    ...commonOptions,
    entry: {
      'node_modules/pg-native/index': 'packages/pg-native/src/index.ts',
    },
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
          to: 'node_modules/pg-native',
        },
      ],
    }),
  ]
}
