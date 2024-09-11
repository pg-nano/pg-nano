import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/plugin.ts', 'src/params.ts'],
  format: ['esm'],
  dts: false, // Disable until plugin is worked on again.
})
