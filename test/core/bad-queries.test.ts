import { sql } from 'pg-nano'
import { uid } from 'radashi'
import { getClientFactory } from './util.js'

const getClient = getClientFactory()

test('SELECT from non-existent table', async () => {
  const client = getClient()
  await expect(() =>
    client.query(sql`SELECT * FROM unknown_table`),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [PgResultError: ERROR:  relation "unknown_table" does not exist
    LINE 1: SELECT * FROM unknown_table
                          ^
    ]
  `)
})

test('rollback on query error', async () => {
  const client = getClient()
  const tableId = uid(20)
  try {
    await client.query(sql`
      BEGIN;
      CREATE TABLE ${sql.id(tableId)} (id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY, name text);
      INSERT INTO ${sql.id(tableId)} (name) VALUES ('Bob');
      SELECT 1/0; -- Error
      INSERT INTO ${sql.id(tableId)} (name) VALUES ('Alice'); -- Should not run
      COMMIT;
    `)
  } catch (error) {
    expect(error).toMatchInlineSnapshot(`
      [PgResultError: ERROR:  division by zero
      ]
    `)
  }
  // Check that the table does not exist.
  const exists = await client.queryValue<boolean>(
    sql`SELECT EXISTS (SELECT oid FROM pg_class WHERE relname = ${sql.val(tableId)})`,
  )
  expect(exists).toBe(false)
})
