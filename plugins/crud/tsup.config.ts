import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/crud.ts', 'src/where.ts'],
  format: ['esm'],
  dts: true,
})
