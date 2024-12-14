import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.test.ts'],
    exclude: ['**/ephemeralpg/**'],
    setupFiles: ['test/setup.ts'],
    isolate: false,
    reporters: 'verbose',
    env: {
      TEST: 'pg-nano',
    },
  },
  plugins: [tsconfigPaths()],
})
