import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/plugin.ts', 'src/runner.ts'],
  format: ['esm'],
  treeshake: 'smallest',
  minifySyntax: !process.env.DEV,
  dts: !process.env.DEV,
})
