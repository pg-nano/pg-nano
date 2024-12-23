import { sql, type SQLTemplate } from 'pg-nano'
import { cartesianProduct } from 'radashi'
import { tupleMarkedObjects } from '../../packages/pg-native/src/value.js'
import { getClient } from './util.js'

const tuple = <T extends object>(obj: T) => {
  tupleMarkedObjects.add(obj)
  return obj
}

describe('stringify', () => {
  test('escaped literals in row/array literals', async () => {
    const client = await getClient()

    await client.query(sql`
      -- row -> text/json
      CREATE TYPE foo AS (x text, y json);
      -- row -> array -> row
      CREATE TYPE bar AS (foo_array foo[]);
      -- row -> row
      CREATE TYPE foo2 AS (f foo);
      CREATE TYPE foo3 AS (f foo2);
      -- row -> array -> row -> row
      CREATE TYPE bar2 AS (foo_array foo2[]);
    `)

    await client.reloadCustomTypes()

    expect(
      await client.queryValue(sql`SELECT '{"(\\"a\\",)"}'::foo[]`),
    ).toMatchInlineSnapshot(`
      [
        {
          "x": "a",
          "y": null,
        },
      ]
    `)

    const texts = ['a', 'b']
    const jsons = [{ a: 1, b: 2 }]

    const foo = tuple({
      x: '1',
      y: { z: 2 },
    })

    const bar = tuple({
      foo_array: [foo],
    })

    const foo2 = tuple({
      f: foo,
    })

    const bar2 = tuple({
      foo_array: [foo2],
    })

    const query =
      (value: unknown, type: string) =>
      (wrap: typeof sql.val): [SQLTemplate, unknown] => {
        const template = sql`
          SELECT ${wrap(value)}::${sql.unsafe(type)}
        `

        // Compute the template's lazy properties.
        client.stringify(template)

        return [template, value]
      }

    // We need to test both `sql.val()` and `sql.param()` because the escaping
    // logic is different for each.
    const queries = cartesianProduct(
      [
        query(texts, 'text[]'),
        query(jsons, 'json[]'),
        query(foo, 'foo'),
        query([foo], 'foo[]'),
        query(bar, 'bar'),
        query([bar], 'bar[]'),
        query(foo2, 'foo2'),
        query([foo2], 'foo2[]'),
        query(bar2, 'bar2'),
      ],
      [sql.val, sql.param],
    ).map(([query, wrap]) => query(wrap as typeof sql.val))

    const templates = queries.map(([template]) => template)

    expect(
      templates.map(template =>
        template.params?.length ? template.params[0] : template.command!.trim(),
      ),
    ).toMatchInlineSnapshot(`
      [
        "SELECT '{"a","b"}'::text[]",
        "{"a","b"}",
        "SELECT  E'{"{\\\\"a\\\\":1,\\\\"b\\\\":2}"}'::json[]",
        "{"{\\"a\\":1,\\"b\\":2}"}",
        "SELECT  E'("1","{\\\\"z\\\\":2}")'::foo",
        "("1","{\\"z\\":2}")",
        "SELECT  E'{"(\\\\"1\\\\",\\\\"{\\\\\\\\\\\\"z\\\\\\\\\\\\":2}\\\\")"}'::foo[]",
        "{"(\\"1\\",\\"{\\\\\\"z\\\\\\":2}\\")"}",
        "SELECT  E'("{\\\\"(\\\\\\\\\\\\"1\\\\\\\\\\\\",\\\\\\\\\\\\"{\\\\\\\\\\\\\\\\\\\\\\\\\\\\"z\\\\\\\\\\\\\\\\\\\\\\\\\\\\":2}\\\\\\\\\\\\")\\\\"}")'::bar",
        "("{\\"(\\\\\\"1\\\\\\",\\\\\\"{\\\\\\\\\\\\\\"z\\\\\\\\\\\\\\":2}\\\\\\")\\"}")",
        "SELECT  E'{"(\\\\"{\\\\\\\\\\\\"(\\\\\\\\\\\\\\\\\\\\\\\\\\\\"1\\\\\\\\\\\\\\\\\\\\\\\\\\\\",\\\\\\\\\\\\\\\\\\\\\\\\\\\\"{\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\"z\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\":2}\\\\\\\\\\\\\\\\\\\\\\\\\\\\")\\\\\\\\\\\\"}\\\\")"}'::bar[]",
        "{"(\\"{\\\\\\"(\\\\\\\\\\\\\\"1\\\\\\\\\\\\\\",\\\\\\\\\\\\\\"{\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\"z\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\":2}\\\\\\\\\\\\\\")\\\\\\"}\\")"}",
        "SELECT  E'("(\\\\"1\\\\",\\\\"{\\\\\\\\\\\\"z\\\\\\\\\\\\":2}\\\\")")'::foo2",
        "("(\\"1\\",\\"{\\\\\\"z\\\\\\":2}\\")")",
        "SELECT  E'{"(\\\\"(\\\\\\\\\\\\"1\\\\\\\\\\\\",\\\\\\\\\\\\"{\\\\\\\\\\\\\\\\\\\\\\\\\\\\"z\\\\\\\\\\\\\\\\\\\\\\\\\\\\":2}\\\\\\\\\\\\")\\\\")"}'::foo2[]",
        "{"(\\"(\\\\\\"1\\\\\\",\\\\\\"{\\\\\\\\\\\\\\"z\\\\\\\\\\\\\\":2}\\\\\\")\\")"}",
        "SELECT  E'("{\\\\"(\\\\\\\\\\\\"(\\\\\\\\\\\\\\\\\\\\\\\\\\\\"1\\\\\\\\\\\\\\\\\\\\\\\\\\\\",\\\\\\\\\\\\\\\\\\\\\\\\\\\\"{\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\"z\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\":2}\\\\\\\\\\\\\\\\\\\\\\\\\\\\")\\\\\\\\\\\\")\\\\"}")'::bar2",
        "("{\\"(\\\\\\"(\\\\\\\\\\\\\\"1\\\\\\\\\\\\\\",\\\\\\\\\\\\\\"{\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\"z\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\":2}\\\\\\\\\\\\\\")\\\\\\")\\"}")",
      ]
    `)

    const result = await Promise.all(
      templates.map(template => client.queryValue(template).catch(e => e)),
    )

    // Expect the query result to match the input values.
    expect(result).toEqual(queries.map(([_, value]) => value))
  })
})
