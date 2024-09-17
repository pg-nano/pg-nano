import crud from '@pg-nano/plugin-crud'
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
  },
  plugins: [crud()],
})