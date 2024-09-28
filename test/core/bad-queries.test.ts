import { Client, sql, type ClientConfig } from 'pg-nano'
import { randomId } from '../util.js'

let client: Client

const getClient = async (config?: Partial<ClientConfig>) =>
  new Client(config).connect(process.env.PG_TMP_DSN!)

afterEach(async () => {
  await client?.close()
})

test('SELECT from non-existent table', async () => {
  client = await getClient()
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
  client = await getClient()
  const tableId = randomId()
  try {
    await client.query(sql`
      BEGIN;
      CREATE TABLE ${tableId} (id serial PRIMARY KEY, name text);
      INSERT INTO ${tableId} (name) VALUES ('Bob');
      SELECT 1/0; -- Error
      INSERT INTO ${tableId} (name) VALUES ('Alice'); -- Should not run
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
    sql`SELECT EXISTS (SELECT 1 FROM ${tableId})`,
  )
  expect(exists).toBe(false)
})
