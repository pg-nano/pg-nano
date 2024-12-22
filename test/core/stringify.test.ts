import { sql } from 'pg-nano'
import { Tuple } from 'pg-native'
import { getClient } from './util.js'

describe('stringify', () => {
  test(
    'string in row literal in array literal',
    { timeout: Number.POSITIVE_INFINITY },
    async () => {
      const client = await getClient()

      await client.query(sql`
        CREATE TYPE foo AS (a text, b text, c text)
      `)

      await client.reloadCustomTypes()

      const template = sql`
        SELECT ${sql.param([new Tuple('a', 'b', null)])}::foo[]
      `

      expect(client.stringify(template).trim()).toMatchInlineSnapshot(
        `"SELECT $1::foo[]"`,
      )
      expect(template.params?.[0]).toMatchInlineSnapshot(
        `"{"(\\"a\\",\\"b\\",)"}"`,
      )
      await expect(
        client.queryRowList(template),
      ).resolves.toMatchInlineSnapshot(`
        [
          {
            "foo": [
              {
                "a": "a",
                "b": "b",
                "c": null,
              },
            ],
          },
        ]
      `)
    },
  )
})
