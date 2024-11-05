Try `pg-nano` out for yourself with this exhaustive demo.

### Project structure

- See the `./sql/` directory for the SQL schema and the generated TypeScript definitions.
- See the `./test.ts` module for sample client usage.

### Pre-requisites

- [pnpm](https://pnpm.io/installation)
- [postgres](https://www.postgresql.org/download/)

### Setup

> [!NOTE]
> The following instructions install `pg-nano` from NPM. If you plan to edit `pg-nano` itself or you want to try unreleased changes, skip running `pnpm start` and do the following instead:
> ```sh
> pnpm install
> pnpm dev
> ```

```sh
git clone https://github.com/pg-nano/pg-nano.git
cd pg-nano/demos/exhaustive

# Install project dependencies, initialize the database, and
# enable reactive schema updates and code generation.
pnpm start

# Run "test.ts" then watch it re-run as you edit the code.
pnpm test
```

If you also plan to edit pg-nano itself, avoid using `pnpm start` as it will install directly from NPM. Instead, run `pnpm install` to install dependencies for the whole monorepo, then `pnpm dev` to enable reactive schema updates and code generation.
