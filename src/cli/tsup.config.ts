import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['main.ts'],
  outDir: '../../dist/cli',
  format: ['esm'],
  external: ['pg-native', 'pg-nano', 'debug'],
  treeshake: 'smallest',
  minifySyntax: !process.env.DEV,
  tsconfig: '../../tsconfig.json',
})
