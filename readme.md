# pg-nano

Harness the power of Postgres without limitations, using a simple, low-overhead approach with type-safe calls to Postgres UDFs from TypeScript.

## Our Approach

- **Goal 1: Have access to every feature of Postgres.**
  - Avoid ORM limitations by writing raw SQL.
  - Keep as much data logic out of TypeScript as possible, making it easier to
    migrate away from TypeScript (if we ever want to).
  - **Our solution:**
    - Make a `sql` directory for all of your `.pgsql` files.
    - *optional –* Separate your schema (i.e. your tables, views, indexes,
      triggers, types, etc.) from your UDFs by creating two subdirectories:
      `sql/schema` and `sql/functions`
    - Give each UDF its own file in the `sql` directory.
    - Give each table/view its own file in the `sql` directory. Indexes and
      triggers can be co-located with the related table.
    - Give each type its own file in the `sql` directory. Nested types and enums
      may be co-located with the related type.

- **Goal 2: Enable rapid development of the database schema.**
  - Ensure the development cycle is as fast as possible.
  - Avoid manual schema setup and migrations.
  - Save your data browser for browsing data, not for schema development.
  - **Our solution:**
    - The `pg-nano dev` command watches your `.pgsql` files and generates SQL
      migrations using
      [pg-schema-diff](https://github.com/stripe/pg-schema-diff) (created by
      folks at Stripe) whenever the schema changes.
    - These migrations are automatically applied to your database during
      development, allowing edits to `.pgsql` files to be reflected in the
      database immediately.

- **Goal 3: Type-safe calls to Postgres UDFs from TypeScript.**
  - Avoid costly mistakes from runtime type errors. Ensure the TypeScript
    application server is as bug-free as possible.
  - **Our solution:**
    - Apply “code generation” techniques to create always-in-sync TypeScript
      definitions for your Postgres UDFs.
    - Introspect your Postgres database to automatically generate these
      definitions.

- **Goal 4: Keep the client library simple.**
  - Avoid the unnecessary complexity of “full-featured Postgres clients” like
    the `pg` and `postgres` packages.
  - **Our solution:**
    - Take advantage of the amazing `pg-native` package for Node.js (written by
      the author of `pg`), which is a slim wrapper around `libpq`, the [Postgres
      C API](https://www.postgresql.org/docs/current/libpq.html).

- **Goal 5: Take advantage of Postgres UDFs.**
  - Reduce the number of round-trips between Node.js and Postgres.
  - Benefit from reduced overhead in query planning and execution.
  - Benefit from Postgres caching of idempotent operations.
