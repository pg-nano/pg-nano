import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'index.ts',
    config: 'config/config.ts',
    plugin: 'config/plugin.ts',
  },
  outDir: '../../dist/node',
  format: ['esm'],
  external: ['pg-native'],
  treeshake: 'smallest',
  minifySyntax: !process.env.DEV,
  tsconfig: '../../tsconfig.json',
  dts: !process.env.DEV,
})
