import crud from '@pg-nano/plugin-crud'
import typebox from '@pg-nano/plugin-typebox'
import { defineConfig } from 'pg-nano/config'

export default defineConfig({
  dev: {
    connection: {
      host: process.env.DEV_CONTAINER === 'pg-nano' ? 'postgres' : 'localhost',
      port: 5432,
      dbname: 'postgres',
      user: 'postgres',
      password: 'postgres',
    },
  },
  schema: {
    include: ['**/*.pgsql'],
  },
  generate: {
    outFile: 'sql/schema.ts',
    postGenerateScript: 'pnpm format',
  },
  plugins: [crud(), typebox()],
})
