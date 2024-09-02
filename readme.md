# pg-nano

<div align="center">
  <p align="center">
    <img src="https://github.com/pg-nano/pg-nano/raw/master/.github/img/banner.png" alt="pg-nano" width="100%" />
  </p>
</div>

I've developed a powerful approach for using Postgres with TypeScript that eliminates common frustrations and boosts productivity. Here's what it offers:

1. **Full Postgres feature access:** No ORM limitations.
2. **Instant schema updates:** Changes reflect immediately in development.
3. **Generated type definitions:** Eliminates runtime errors from mismatched types when calling Postgres functions from TypeScript.
4. **Streamlined workflow:** Write raw SQL and call Postgres functions directly from TypeScript.
5. **Performance optimization:** Reduce round-trips between TypeScript and Postgres.
6. **Purpose built:** Includes a minimal Postgres client that is designed to work seamlessly with the pg-nano approach. Connection pooling is handled automatically.

This approach ensures clean database logic, robust TypeScript code, and an efficient development process. Whether you're a solo developer or part of a large team, it offers significant value by maximizing your database capabilities and streamlining your workflow.

I've been using this in my own projects with great success, and I'm confident it can transform the way you work with Postgres and TypeScript too.

## Installation

```
pnpm add pg-nano
```

## Getting started

## Command-line usage

The `dev` command starts a long-running process that does two things:

1. It watches your SQL files for changes and automatically migrates your development Postgres instance to match your schema.
2. It generates type definitions for your Postgres functions and custom types.

```
pnpm pg-nano dev
```

## TypeScript usage

The first step is to create a `Client` instance and connect it to your Postgres database.

```ts
import { Client } from 'pg-nano'

// Note: These options are the defaults.
const client = new Client({
  minConnections: 1,
  maxConnections: 100,
  initialRetryDelay: 250,
  maxRetryDelay: 10e3,
  maxRetries: Number.POSITIVE_INFINITY,
  idleTimeout: 30e3,
})

await client.connect('postgres://user:password@localhost:5432/database')
```

Upon running `pg-nano dev`, type definitions are generated and saved to your SQL folder as `api.ts`. You may choose to commit this file to your repository.

To call your Postgres functions from TypeScript, use the `client.proxy` method. Put the following code in the same module where you created the `Client` instance.

```ts
import * as API from './sql/api'

export default client.proxy(API)
```

Let's say you have a Postgres function like this:

```sql
CREATE OR REPLACE FUNCTION get_user_by_id(id bigint)
RETURNS TABLE (
  id bigint,
  name text
) AS $$
BEGIN
  RETURN QUERY
  SELECT id, name
  FROM users
  WHERE id = $1;
END;
$$ LANGUAGE plpgsql;
```

Assuming your `Client` instance is in the `./client.ts` file, you can call this function from TypeScript like this:

```ts
import client from './client'

const user = await client.getUserById(1)

console.log(user) // => { id: 1, name: 'Baby Yoda' }
```

Input values are automatically stringified and escaped, and output values are automatically parsed as JSON.

### Dynamic queries

In case you need to dynamically generate a query, the `Client` instance provides `many`, `one`, and `scalar` methods. Dynamic queries are not type-safe and their result must be manually typed.

Dynamic queries can be unsafe if not handled properly. To ensure you don't accidentally allow a SQL injection attack, you must use our `sql` tagged template literal for dynamic queries.

```ts
import { sql } from 'pg-nano'
import client from './client'

// Dynamic queries must be manually typed.
type User = {
  id: number
  name: string
  age: number
}

function getUsersOlderThan(age: number) {
  return client.many<User>(
    sql`
      SELECT * FROM users
      WHERE age >= ${sql.val(age)}
      LIMIT 25
    `
  )
}

const selectedUsers = await getUsersOlderThan(50)
console.log(selectedUsers) // => [{ id: 1, name: 'Baby Yoda', age: 50 }]
```

Queries defined with `sql` can be nested within other `sql` queries.

For string interpolation, `sql` comes with the following methods:

- `sql.val(value: any)`: For literal values.
- `sql.id(value: string)`: For identifiers (e.g. table names, column names).
- `sql.raw(value: string)`: For raw SQL syntax.

### Streaming results

Queries that return a set can be iterated over asynchronously. This allows for efficient streaming of large result sets without loading them all into memory at once.

In this example, we're using the dynamic query we created earlier to get all users older than 50. Static queries can also be iterated over asynchronously.

```ts
import client from './client'

for await (const user of getUsersOlderThan(50)) {
  console.log(user)
}
```

### Closing the client

The `Client` instance automatically manages its own connections. When you're finished using the client, you should call `client.close()` to close all connections and release resources.

```ts
await client.close()
```

## Development

If you'd like to make changes to pg-nano itself, you can run `pnpm dev` to start a long-running process that compiles the project and rebuilds it on every change. Be sure to first run `pnpm install` in the project root to install the project's dependencies.

```
pnpm dev
```

You can play with your changes in the `./demos/exhaustive` directory.

```
cd demos/exhaustive
pnpm pg-nano dev
```

## License

MIT
