# @pg-nano/plugin-match

This plugin generates Postgres routines for matching rows with a Prisma-style declarative TypeScript API.

🚧 **This plugin is unreleased and currently shelved. See #6 for details.**

## Usage

```ts
import match from '@pg-nano/plugin-match'

export default defineConfig({
  plugins: [
    match({
      // Customize how table names are pluralized.
      pluralize: (noun) => noun,
    })
  ],
})
```

## Generated routines

For every table, the following routines are generated:

- `list_widgets(filter JSON) RETURNS SETOF widget`
- `count_widgets(filter JSON) RETURNS INTEGER`
- `find_widget(filter JSON) RETURNS widget`

On the TypeScript side, these routines are more safely typed. The `filter` argument adopts the same API as Prisma's [filter conditions](https://www.prisma.io/docs/orm/reference/prisma-client-reference#filter-conditions-and-operators).

Support for sorting, pagination, and cursors is planned.
