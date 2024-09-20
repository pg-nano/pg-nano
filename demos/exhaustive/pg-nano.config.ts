import crud from '@pg-nano/plugin-crud'
import typebox from '@pg-nano/plugin-typebox'
import { defineConfig } from 'pg-nano/config'

export default defineConfig({
  dev: {
    host: 'localhost',
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: 'postgres',
  },
  schema: {
    include: ['**/*.pgsql'],
  },
  generate: {
    outFile: 'sql/schema.ts',
  },
  plugins: [
    crud(),
    typebox({
      formatScript: 'pnpm format',
    }),
  ],
})
