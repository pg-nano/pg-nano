⚠️ **This project is currently in the early stages of development and is not yet ready for production use.**

# pg-nano

<div align="center">
  <p align="center">
    <img src="https://github.com/pg-nano/pg-nano/raw/master/.github/img/banner.png" alt="pg-nano" width="100%" />
  </p>
</div>

You like TypeScript. You like Postgres. You like the idea of combining the two seamlessly. You dislike being restricted by ORMs. You dislike writing trivial migrations by hand. You're ready to embrace plain SQL or a procedural language like PL/pgSQL. If these statements describe you, then pg-nano is for you.

pg-nano is a native Postgres driver for TypeScript, a TypeScript code generator, and a Postgres migration tool.

Here's what you can do with pg-nano:

- Generate fully-typed TypeScript bindings that make calling your Postgres functions from your application server a breeze.
- Write your Postgres functions in plain SQL or any procedural language ([PL/pgSQL](https://www.postgresql.org/docs/current/plpgsql.html), [PL/V8](https://github.com/plv8/plv8), [PL/Rust](https://github.com/tcdi/plrust), and more).
- Instantly update your local Postgres instance to match the declarative `CREATE` statements in your project (version control friendly). Save changes to your SQL files and watch your TypeScript bindings refresh immediately. Deleted statements are dropped from your database.
- Migrate your schema automatically ~80% of the time. Migrations are generated by [stripe/pg-schema-diff](https://github.com/stripe/pg-schema-diff) with a technique called *schema diffing*.
- Our Postgres driver integrates with [libpq](https://www.postgresql.org/docs/9.5/libpq.html), the official Postgres C library, so it's fast and reliable.
- Query streaming, SQL templating, connection pooling, and “reconnect with backoff” come built-in. “Pipeline mode” is planned for the future (subscribe to [#1](https://github.com/pg-nano/pg-nano/issues/1) for updates).
- [Composite types](https://www.postgresql.org/docs/current/rowtypes.html) are automatically parsed and come with type definitions. Other NPM packages either give you a string and/or require custom parsing logic.
- Field name conversion is supported out of the box. Want camel case in your TypeScript but snake case in your database? No problem. Don't want that? Disable it with `fieldCase: FieldCase.preserve`.
- Customize the generated TypeScript definitions, generate SQL statements, and extend the client's data type handling with pg-nano's compile-time plugin system, inspired by Vite. See [@pg-nano/plugin-crud](https://github.com/pg-nano/pg-nano/tree/master/plugins/crud) for an example.
- With stored procedures, query performance is improved (thanks to “execution plan” caching, reduced data transfer, minimized round-trips, and efficient complex data processing closer to the data source). This is especially true for frequently executed complex queries and high-volume data operations.

**Still have questions?** Check out the [FAQ](#faq) below.

**Join the community:** Your perspective matters! [Open an issue](https://github.com/pg-nano/pg-nano/issues) or [submit a PR](https://github.com/pg-nano/pg-nano/pulls). You can also DM me on Discord (@aleclarson) if you'd like to chat.

**Try our demo:** Clone pg-nano and run the [exhaustive demo](https://github.com/pg-nano/pg-nano/tree/master/demos/exhaustive) to see how it works.

## Getting started

### Installation

The `pg-nano` package includes a Postgres driver and a CLI.

```
pnpm add pg-nano
```

### Project structure

1. Create a `sql` directory for your project. Put your SQL files in here. They can be named anything you want, but they must have one of these extensions: `.sql`, `.pgsql`, or `.psql`.
   - For project structure, I'm a fan of “feature folders” (e.g. user-related statements all go in the `sql/users`  directory).
   - I also like to give each `CREATE` statement its own file (one exception: indexes and triggers belong in the same  file as the table they are for).
   - Lastly, note that you can write your `CREATE` statements *without* the `OR REPLACE` clause, since `pg-nano` will  handle that for you (thanks to `pg-schema-diff`).

2. Run `pnpm pg-nano init` to initialize your project. This will create a `pg-nano.ts` file in the current directory.

Now you're ready to start using pg-nano.

### Plugins

Here's a list of actively maintained plugins:
- [@pg-nano/plugin-crud](https://github.com/pg-nano/pg-nano/tree/master/plugins/crud) (auto-generates CRUD functions for your tables)
- [@pg-nano/plugin-typebox](https://github.com/pg-nano/pg-nano/tree/master/plugins/typebox) (auto-generates [TypeBox](https://github.com/sinclairzx81/typebox) runtime type validators for your Postgres tables, enums, and composite types)
- *If you write a plugin, please submit a PR adding it here!*

Currently, the plugin API is undocumented, but you can check out the [type definitions](https://github.com/pg-nano/pg-nano/blob/master/src/plugin/plugin.ts) to get an idea of how they work.

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

### Streaming results

Queries that return a set can be iterated over asynchronously. This allows for efficient streaming of large result sets without loading them all into memory at once.

In this example, we're using the dynamic query we created earlier to get all users older than 50. Static queries can also be iterated over asynchronously.

```ts
import client from './client'

for await (const user of client.getUsersOlderThan(50)) {
  console.log(user)
}
```

### Dynamic queries

pg-nano has built-in support for dynamic queries and SQL templating, though this feature is generally not recommended unless absolutely necessary. For more details, check out the [Dynamic queries](https://github.com/pg-nano/pg-nano/wiki/Dynamic-queries) wiki page.

### Closing the client

The `Client` instance automatically manages its own connections. When you're finished using the client, you should call `client.close()` to close all connections and release resources.

```ts
await client.close()
```

### Reserved namespace

The `nano` schema is reserved for use by pg-nano. It is used to store temporary objects during diffing. You should not use the `nano` schema in your own project, since it will be dropped by `pg-nano` during development.

&nbsp;

## FAQ

### Are there any caveats?

Here are some caveats with the pg-nano approach.

1. Every object in your database **must** be declared with a `CREATE` statement in your SQL directory. For example, if you create a table through your database GUI client, it will be dropped the next time you save a SQL file that `pg-nano dev` is watching. This behavior is necessary to ensure that any `CREATE` statements you remove during development are not left over in your Postgres instance.

1. Writing raw PL/pgSQL for *everything* can be tedious, especially if you're doing a lot of basic CRUD queries. Luckily, the [@pg-nano/plugin-crud](https://github.com/pg-nano/pg-nano/tree/master/plugins/crud) package can generate basic CRUD queries for your tables at compile time, so you can avoid writing repetitive code as often as possible. 

   Even better, you can write your own plugins, since pg-nano has a plugin system for generating SQL based on your schema. All plugin-generated SQL immediately has TypeScript definitions generated for it.

1. Some Postgres features are not yet supported by pg-schema-diff (the tool used by pg-nano to automatically migrate your schema during development). In some cases (e.g. with composite types and views), pg-nano handles the migration instead, but there are still some missing pieces.

   The (probably incomplete) list of missing features:

   - Materialized views (#11)
   - Generated columns (https://github.com/stripe/pg-schema-diff/issues/165)
   - Table privileges (https://github.com/stripe/pg-schema-diff/issues/124)
   - Variadic parameters (#9)
   - Function overloading (#8)
   - LISTEN/NOTIFY (#5)
   - [Domain types](https://www.postgresql.org/docs/current/sql-createdomain.html)
   - [Pseudo types](https://www.postgresql.org/docs/current/extend-type-system.html#EXTEND-TYPE-SYSTEM-PSEUDO)
   - [Transforms](https://www.postgresql.org/docs/current/sql-createtransform.html)
   - Circular foreign key constraints (#34)
   - Custom range types (#39)
   - Multi-dimensional arrays as input parameters (#47)

### What Postgres features are definitely supported?

You can be sure these features are supported:

- [x] Arrays
- [x] Check constraints
- [x] Composite types
- [x] Enums
- [x] Foreign key constraints
- [x] Functions
  - [x] Named and unnamed parameters
  - [x] Any valid return type (including `SETOF`)
- [x] Identity columns
- [x] Indexes
- [x] Procedures
- [x] Sequences
- [x] Single row mode
- [x] Tables
- [x] Triggers
- [x] Views

Since pg-nano uses [libpg_query](https://github.com/pganalyze/libpg_query) to parse your SQL, we're able to support features before pg-schema-diff does. This is how we support composite types and views, for example. This also allows pg-nano to build a dependency graph to ensure database objects are created in the correct order.

### What's the roadmap?

I'm an independent developer without big sponsors, so I only develop what I need (or sometimes want). I keep track of cool ideas in the issues, but I don't promise that I'll develop them. Collaboration is welcome if you'd like to help me push pg-nano forward.

&nbsp;

## Development

### Pre-requisites

- [node](https://nodejs.org/en/download/) **v20.12+**
- [pnpm](https://pnpm.io/installation) **v9.x**
- [postgres](https://www.postgresql.org/download/) **v14+**

### Setup

Set up the local workspace.

```sh
git clone https://github.com/pg-nano/pg-nano.git
cd pg-nano
git submodule update --init --recursive
pnpm install
pnpm build
```

The `dev` command compiles the TypeScript modules of the `pg-nano` and `@pg-nano/plugin-*` packages. It re-compiles on file changes.

```sh
pnpm dev
```

### Playground

You can play with your changes in the `./demos/exhaustive` directory.

```sh
cd demos/exhaustive
pnpm dev
```

### C++ development

If you're editing C++ code in `packages/libpq`, you'll want to have [compiledb](https://github.com/nickdiego/compiledb) installed and the [clangd extension](https://marketplace.visualstudio.com/items?itemName=llvm-vs-code-extensions.vscode-clangd) in VSCode. This enables the `clangd` language server for features like autocomplete, static analysis, and code navigation.

```sh
brew install compiledb
```

The `libpq` package is compiled on install. If you make changes, you'll need one of the following commands to recompile. You must run these commands from the `./packages/libpq` directory.

```sh
# Rebuilds the package
pnpm build

# Automatically rebuilds on file changes
pnpm dev
```

## License

MIT
