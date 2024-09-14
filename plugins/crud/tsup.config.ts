import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/plugin.ts', 'src/field-mappers.ts'],
  format: ['esm'],
  dts: true,
})
