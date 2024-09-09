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

### Why was pg-nano created?

I wanted a better way to work with Postgres and TypeScript. I believe that raw SQL is the best way to work with Postgres, but I found that existing libraries were not a good fit for my needs. I knew I wanted generated type definitions, but I also wanted an easy way to work with dynamic queries. I also discovered [stripe/pg-schema-diff](https://github.com/stripe/pg-schema-diff), which introduced me to the concept of “schema diffing” for migrations. It was then that I realized `pg-schema-diff` could be used for rapid schema development (effortless schema changes). This all culminated in the creation of pg-nano. Welcome to the future!

### What does your tagline mean?

> TypeScript-first, Node-API wrapper for libpq, centered on PL/pgSQL functions and rapid schema development 

This tagline encapsulates the key features and design philosophy of pg-nano:

1. "TypeScript-first": pg-nano is designed with TypeScript in mind, providing strong typing and excellent developer experience for TypeScript users.

2. "Node-API wrapper for libpq": It's a thin wrapper around libpq (the official PostgreSQL C library) using Node-API, which provides high performance and direct access to PostgreSQL features.

3. "centered on PL/pgSQL functions": pg-nano encourages the use of PostgreSQL's procedural language (PL/pgSQL) for complex database operations, allowing you to leverage the full power of PostgreSQL.

4. "rapid schema development": All changes to your SQL files are immediately reflected in your Postgres instance and your TypeScript code, enabling rapid development and iteration.

### Caveats

Here are some caveats with the pg-nano approach.

1. Every object in your database **must** be declared with a `CREATE` statement in your SQL directory. For example, if you create a table through your database GUI client, it will be deleted by pg-schema-diff while `pg-nano dev` is running. This behavior is necessary to ensure that any `CREATE` statements you remove during development are not left over in your Postgres instance.

2. Some Postgres features are not yet supported by pg-schema-diff (the tool used by pg-nano to automatically migrate your schema during development). In some cases (like with composite types), pg-nano handles the migration instead, but there are still some missing pieces.

3. Writing raw SQL for *everything* can be tedious, especially if you're doing a lot of basic CRUD queries. Luckily, pg-nano has a plugin system for generating SQL based on your schema. Any plugin-generated SQL will also have TypeScript definitions generated for it. Even better, you can use the [@pg-nano/plugin-crud](https://github.com/pg-nano/pg-nano/tree/master/plugins/crud) package to generate basic CRUD queries for your tables, so you get the benefits of ORMs without the limitations. Of course, you can even write your own plugins if you want to.

## Installation

```
pnpm add pg-nano
```

## Getting started

1. Create a `sql` directory for your project. Put your SQL files in here. They can be named anything you want, but they must have one of these extensions: `.sql`, `.pgsql`, or `.psql`.
   - For project structure, I'm a fan of “feature folders” (e.g. user-related statements all go in the `sql/users`  directory).
   - I also like to give each `CREATE` statement its own file (one exception: indexes and triggers belong in the same  file as the table they are for).
   - Lastly, note that you can write your `CREATE` statements *without* the `OR REPLACE` clause, since `pg-nano` will  handle that for you (thanks to `pg-schema-diff`).

2. Run `pnpm pg-nano init` to initialize your project. This will create a `pg-nano.ts` file in the current directory.

Now you're ready to start using pg-nano.

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

To call your Postgres functions from TypeScript, use the `client.withQueries` method. Put the following code in the same module where you created the `Client` instance.

```ts
import * as API from './sql/api'

export default client.withQueries(API)
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

In case you need to dynamically generate a query, the `Client` instance provides the following methods: 

- **query(sql)**: Execute one or more statements, returning an array of `Result` objects (one per statement).
- **queryRows(sql)**: Execute one statement that returns multiple rows.
- **queryOneRow(sql)**: Execute one statement that returns a single row.
- **queryOneColumn(sql)**: Execute one statement that returns a single column value.

**_Type safety:_** Dynamic queries are not type-safe and their result must be manually typed. For example, `queryRows<User>()` will return an array of `User` objects, which only you can guarantee is the correct type.

**_Security:_** Dynamic queries can be unsafe if not handled properly. To ensure you don't accidentally allow a SQL injection attack, you must use our `sql` tagged template literal to define the query.

**_Options:_** Each method also accepts an optional `options` parameter. As of now, this only supports the `signal` option, which allows you to cancel the query early when this signal is aborted.

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
  return client.queryRows<User>(
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

```ts
import { sql } from 'pg-nano'

// Define two separate SELECT statements
const activeUsersQuery = sql`
  SELECT id, name
  FROM users
  WHERE status = 'active'
`

const recentOrdersQuery = sql`
  SELECT user_id, COUNT(*) as order_count
  FROM orders
  WHERE order_date >= DATE_SUB(CURRENT_DATE, INTERVAL 30 DAY)
  GROUP BY user_id
`

// Combine the queries to get active users with their recent order counts
const activeUsersWithRecentOrders = sql`
  SELECT u.id, u.name, COALESCE(o.order_count, 0) as recent_order_count
  FROM (${activeUsersQuery}) u
  LEFT JOIN (${recentOrdersQuery}) o ON u.id = o.user_id
  ORDER BY recent_order_count DESC
`

// Execute the combined query
const result = await client.queryRows(activeUsersWithRecentOrders)
console.log(result)
// Example output:
// [
//   { id: 1, name: 'Zara', recent_order_count: 5 },
//   { id: 2, name: 'Raj', recent_order_count: 3 },
//   { id: 3, name: 'Mei', recent_order_count: 0 },
// ]
```

For value interpolation, `sql` comes with the following methods:

- `sql.val(value)`: For literal values.
- `sql.id(...names)`: For identifiers (e.g. table names, column names).
- `sql.join(separator, list)`: For joining an array of template values with a given separator.
- `sql.unsafe(string)`: For raw SQL syntax.

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

### Reserved namespace

The `nano` schema is reserved for use by pg-nano. It is used to store temporary objects during diffing. You should not use the `nano` schema in your own project, since it will be dropped by `pg-nano` during development.

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
