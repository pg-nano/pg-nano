# @pg-nano/plugin-crud

This plugin generates CRUD routines for Postgres tables.

## Usage

```ts
import crud from '@pg-nano/plugin-crud'

export default defineConfig({
  plugins: [
    crud()
  ],
})
```

## Generated routines

For every table, the following routines are generated:

- `get_widget(id INT) RETURNS widget`
- `create_widget(data widget) RETURNS widget`
- `upsert_widget(data widget) RETURNS widget`
- `update_widget(id INT, data JSON) RETURNS widget`
- `replace_widget(id INT, data widget) RETURNS widget`
- `delete_widget(id INT) RETURNS BOOLEAN`

Note that the `get`, `update`, `replace`, and `delete` routines also work for tables with composite primary keys.
