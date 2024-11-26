import { Client, sql, type ClientConfig } from 'pg-nano'
import { stringifyValue, Tuple } from 'pg-native'
import { resetPublicSchema } from 'test/util.js'

let client: Client

const getClient = async (config?: Partial<ClientConfig>) =>
  new Client(config).connect(process.env.PG_TMP_DSN!)

afterEach(async () => {
  await client?.close()
})

describe('sanity', () => {
  test('cast text representation to parsed type', async () => {
    client = await getClient()
    const texts = [
      1,
      [1, 2],
      { json: true },
      new Tuple(0, 0),
      "meet Stacy's dog",
      null,
    ].map(value => {
      return value === null ? null : stringifyValue(value)
    })

    expect(texts).toMatchInlineSnapshot(`
      [
        "1",
        "{1,2}",
        "{"json":true}",
        "(0,0)",
        "meet Stacy's dog",
        null,
      ]
    `)

    const result = await client.queryRow(sql`
      WITH t AS (
        SELECT ${sql.val(texts)}::text[] AS items
      )
      SELECT
        t.items[1]::int AS "number",
        t.items[2]::int[] AS "numbers",
        t.items[3]::json AS "mixed",
        t.items[4]::point AS "point",
        t.items[5]::text AS "text",
        t.items[6]::text AS "null"
      FROM t
    `)

    expect(result).toMatchInlineSnapshot(`
      {
        "mixed": {
          "json": true,
        },
        "null": null,
        "number": 1,
        "numbers": [
          1,
          2,
        ],
        "point": {
          "x": 0,
          "y": 0,
        },
        "text": "meet Stacy's dog",
      }
    `)
  })

  test('record-returning function cannot return null', async () => {
    client = await getClient()

    await resetPublicSchema()

    const result = await client.queryRowOrNull(sql`
      CREATE TABLE foo (
        id integer PRIMARY KEY,
        name text
      );
    
      CREATE FUNCTION test_null()
      RETURNS foo
      LANGUAGE plpgsql
      AS $$
      DECLARE
        result foo;
      BEGIN
        SELECT * FROM foo WHERE id = 1 INTO result;
        IF FOUND THEN
          RAISE NOTICE 'found';
          RETURN result;
        ELSE
          RAISE NOTICE 'not found';
          RETURN NULL;
        END IF;
      END;
      $$;

      SELECT * FROM test_null() WHERE (test_null.*) IS NOT NULL;
    `)

    expect(result).toEqual(null)
  })
})
