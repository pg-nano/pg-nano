# @pg-nano/vitest-plugin

This plugin helps you test your Postgres functions with Vitest.

### Features

- **Automatic schema migrations**: The plugin runs the same logic as the `pg-nano dev` command, so your database is instantly migrated to match your SQL files. In addition, your test suite will automatically rerun when you make changes to your SQL files.

- **Improved error messages**: Postgres errors are reformatted to provide a stack trace like you're used to with JavaScript. This gives you a preview of where the error occurred in your Postgres function, and you can easily option+click to jump to the source code.

## Installation

```bash
pnpm add -D @pg-nano/vitest-plugin
```

## Usage

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import pgNanoVitest from '@pg-nano/vitest-plugin'

export default defineConfig({
  plugins: [
    // Note: These are the default options.
    pgNanoVitest({
      // The directory containing your pg-nano.config.ts file
      root: './',
      // The connection string to your database
      connectionString: 'postgres://postgres:postgres@localhost:5432/postgres',
      // The log level to use for pg-nano migrations and code generation
      logLevel: 'info',
      // Partially override the config file
      config: {},
    })
  ],
})
```

### Using with `@pg-nano/pg-tmp`

The [`@pg-nano/pg-tmp`](https://github.com/pg-nano/pg-tmp) package is a great way to test your Postgres functions in a temporary database. This plugin works great with it!

```bash
pnpm add -D @pg-nano/pg-tmp
```

Start the temporary database before running your tests.

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import pgNanoVitest from '@pg-nano/vitest-plugin'
import * as pgTmp from '@pg-nano/pg-tmp'

// Note: These are the default options
const connectionString = await pgTmp.start({
  // Seconds of inactivity before the database is automatically deleted.
  timeout: 60,
  // If true, the database won't be automatically deleted.
  keep: false,
  // If set to true, an HTTP connection is used instead of a Unix socket.
  host: false,
})

// This exposes the connection string to your globalSetup file.
process.env.TEST_DSN = connectionString

export default defineConfig({
  plugins: [pgNanoVitest({ connectionString })],
  test: {
    globalSetup: './globalSetup.ts',
  }
})
```

Connect your pg-nano client in a `globalSetup` file.

```ts
// globalSetup.ts
import pgClient from './path/to/pg-nano/client'

export default async () => {
  await pgClient.connect(process.env.TEST_DSN)

  return async () => {
    await pgClient.close()
  }
}
```
