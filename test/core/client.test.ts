import { FieldCase, sql } from 'pg-nano'
import { getClient, getClientFactory } from './util.js'

describe('ClientConfig', () => {
  test('fieldCase preserve', async () => {
    const client = await getClient({
      fieldCase: FieldCase.preserve,
    })
    const results = await client.query(sql`SELECT 1 AS foo_bar`)
    expect(results[0].rows[0].foo_bar).toBe(1)
  })
})

describe('Client.prototype', () => {
  const getClient = getClientFactory()

  test('query - multiple commands', async () => {
    const client = getClient()
    const results = await client.query(sql`SELECT 1; SELECT 2`)
    expect(results).toMatchInlineSnapshot(`
      [
        CommandResult {
          "command": "SELECT",
          "fields": [
            {
              "dataTypeID": 23,
              "name": "?column?",
            },
          ],
          "rowCount": 1,
          "rows": [
            {
              "?column?": 1,
            },
          ],
        },
        CommandResult {
          "command": "SELECT",
          "fields": [
            {
              "dataTypeID": 23,
              "name": "?column?",
            },
          ],
          "rowCount": 1,
          "rows": [
            {
              "?column?": 2,
            },
          ],
        },
      ]
    `)
  })

  test('query - for await', async () => {
    const client = getClient()
    const results: any[] = []
    for await (const result of client.query(sql`
      SELECT generate_series(1, 2) AS n;
      SELECT generate_series(3, 4) AS n;
    `)) {
      results.push(result)
    }
    expect(results).toMatchInlineSnapshot(`
      [
        CommandResult {
          "command": "SELECT",
          "fields": [
            {
              "dataTypeID": 23,
              "name": "n",
            },
          ],
          "rowCount": 2,
          "rows": [
            {
              "n": 1,
            },
            {
              "n": 2,
            },
          ],
        },
        CommandResult {
          "command": "SELECT",
          "fields": [
            {
              "dataTypeID": 23,
              "name": "n",
            },
          ],
          "rowCount": 2,
          "rows": [
            {
              "n": 3,
            },
            {
              "n": 4,
            },
          ],
        },
      ]
    `)
  })

  test('queryRowList - for await', async () => {
    const client = getClient()
    const results: any[] = []
    for await (const result of client.queryRowList(sql`
      SELECT generate_series(1, 2) AS n1;
      SELECT generate_series(3, 4) AS n2;
    `)) {
      results.push(result)
    }
    expect(results).toMatchInlineSnapshot(`
      [
        {
          "n1": 1,
        },
        {
          "n1": 2,
        },
        {
          "n2": 3,
        },
        {
          "n2": 4,
        },
      ]
    `)
  })

  test('queryValueList - for await', async () => {
    const client = getClient()
    const results: any[] = []
    for await (const result of client.queryValueList(sql`
      SELECT generate_series(1, 2);
      SELECT generate_series(3, 4);
    `)) {
      results.push(result)
    }
    expect(results).toMatchInlineSnapshot(`
      [
        1,
        2,
        3,
        4,
      ]
    `)
  })

  test('queryRow - basic select', async () => {
    const client = getClient()
    const result = await client.queryRow(sql`SELECT 1 AS one`)
    expect(result).toEqual({ one: 1 })
  })

  test('queryRow - throw on empty result set', async () => {
    const client = getClient()
    await expect(() =>
      client.queryRow(sql`SELECT 1 WHERE false`),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[QueryError: Expected row, got undefined]`,
    )
  })

  test('queryRow - throw on multiple rows', async () => {
    const client = getClient()
    await expect(() =>
      client.queryRow(sql`SELECT generate_series(1, 2)`),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[QueryError: Expected at most 1 row, got 2]`,
    )
  })

  test('queryRowOrNull - tolerate empty result set', async () => {
    const client = getClient()
    const result = await client.queryRowOrNull(sql`SELECT 1 WHERE false`)
    expect(result).toBeNull()
  })

  test('queryValue - basic select', async () => {
    const client = getClient()
    const result = await client.queryValue(sql`SELECT 1`)
    expect(result).toBe(1)
  })

  test('queryValue - throw on empty result set', async () => {
    const client = getClient()
    await expect(() =>
      client.queryValue(sql`SELECT 1 WHERE false`),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[QueryError: Expected row, got undefined]`,
    )
  })

  test('queryValue - throw on multiple rows', async () => {
    const client = getClient()
    await expect(() =>
      client.queryValue(sql`SELECT generate_series(1, 2)`),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[QueryError: Expected at most 1 row, got 2]`,
    )
  })

  test('queryValueOrNull - tolerate empty result set', async () => {
    const client = getClient()
    const result = await client.queryValueOrNull(sql`SELECT 1 WHERE false`)
    expect(result).toBeNull()
  })
})

describe('connection pooling', () => {
  test('multiple connections are opened for parallel queries', async () => {
    vi.useFakeTimers()

    const client = await getClient({
      minConnections: 0,
      maxConnections: 2,
      idleTimeout: 1000,
    })

    const getConnection = vi.spyOn(client as any, 'getConnection')

    const queries = [
      client.queryRow(sql`SELECT pg_sleep(0.1)`),
      client.queryRow(sql`SELECT pg_sleep(0.1)`),
      client.queryRow(sql`SELECT pg_sleep(0.1)`),
    ]

    // No connections are opened until the first query is awaited.
    expect(client.numConnections).toBe(0)
    expect(getConnection).toHaveBeenCalledTimes(0)

    const queriesPromise = Promise.all(queries)
    await Promise.resolve()

    // Only 2 connections are opened, even though there are 3 queries, because
    // of the maxConnections limit.
    expect(client.numConnections).toBe(2)
    expect(getConnection).toHaveBeenCalledTimes(3)

    await queriesPromise

    // The 2 connections should still be open.
    expect(client.numConnections).toBe(2)

    await vi.advanceTimersByTimeAsync(1000)

    // All connections are closed after the idle timeout.
    expect(client.numConnections).toBe(0)
  })
})
