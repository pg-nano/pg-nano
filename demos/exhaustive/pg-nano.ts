import { defineConfig } from 'pg-nano/config'

export default defineConfig({
  dev: {
    connectionString: 'postgres://postgres:postgres@localhost:5432/postgres',
  },
  schema: {
    include: ['**/*.pgsql'],
  },
})
