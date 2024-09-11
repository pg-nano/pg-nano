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

- `get_widget(id INT) RETURNS "widget"%ROWTYPE`
- `create_widget(data JSON) RETURNS "widget"%ROWTYPE`
- `upsert_widget(data JSON) RETURNS "widget"%ROWTYPE`
- `update_widget(id INT, data JSON) RETURNS "widget"%ROWTYPE`
- `replace_widget(id INT, data JSON) RETURNS "widget"%ROWTYPE`
- `delete_widget(id INT) RETURNS BOOLEAN`

Note that the `get`, `update`, `replace`, and `delete` routines also work for tables with composite primary keys.
