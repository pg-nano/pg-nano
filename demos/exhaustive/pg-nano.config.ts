import crud from '@pg-nano/plugin-crud'
import typebox from '@pg-nano/plugin-typebox'
import { defineConfig } from 'pg-nano/config'

export default defineConfig({
  dev: {
    connectionString: 'postgres://postgres:postgres@localhost:5432/postgres',
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
