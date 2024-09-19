import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/plugin.ts', 'src/types.ts'],
  format: ['esm'],
  dts: true,
  external: ['pg-nano'],
  treeshake: 'smallest',
})
