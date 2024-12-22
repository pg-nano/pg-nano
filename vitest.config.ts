import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    isolate: false,
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    reporters: 'verbose',
    env: {
      TEST: 'pg-nano',
    },
  },
  plugins: [tsconfigPaths()],
})
