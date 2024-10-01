import { createProject, dedent, resetPublicSchema } from '../util.js'

const sql = dedent

beforeEach(resetPublicSchema)

describe('@pg-nano/plugin-crud', () => {
  test('basic cases', async () => {
    const project = await createProject(
      {
        'sql/schema.sql': sql`
          CREATE TABLE "user" (
            id serial PRIMARY KEY,
            name text NOT NULL,
            tags text[] DEFAULT '{}'
          );
        `,
      },
      {
        plugins: ['@pg-nano/plugin-crud'],
      },
    )

    await project.generate()
    expect(project.generatedFiles).toMatchSnapshot()

    type Schema =
      typeof import('../__fixtures__/@pg-nano+plugin-crud__basic_cases/sql/schema.js')

    const client = await project.importClient<Schema>()

    // Create a record
    expect(await client.createUser({ name: 'John' })).toEqual({
      id: 1, // <== serial id
      name: 'John',
      tags: [], // <== default value
    })

    // Get a record
    expect(await client.getUser(1)).toEqual({
      id: 1,
      name: 'John',
      tags: [],
    })

    // Update a record
    expect(await client.updateUser(1, { name: 'Jonny' })).toEqual({
      id: 1,
      name: 'Jonny',
      tags: [],
    })

    // Verify update
    expect(await client.getUser(1)).toEqual({
      id: 1,
      name: 'Jonny',
      tags: [],
    })

    // Upsert a record
    expect(
      await client.upsertUser({ id: 1, name: 'John', tags: ['married'] }),
    ).toEqual({
      id: 1,
      name: 'John',
      tags: ['married'],
    })

    // Verify upsert
    expect(await client.getUser(1)).toEqual({
      id: 1,
      name: 'John',
      tags: ['married'],
    })

    // Delete a record
    expect(await client.deleteUser(1)).toEqual(true)

    // Verify deletion
    expect(await client.getUser(1)).toEqual(null)
  })

  test('get - null', async () => {
    const project = await createProject(
      {
        'sql/schema.sql': sql`
          CREATE TABLE foo (
            id integer PRIMARY KEY
          );
        `,
      },
      {
        plugins: ['@pg-nano/plugin-crud'],
      },
    )

    await project.generate()

    type Schema =
      typeof import('../__fixtures__/@pg-nano+plugin-crud__get_null/sql/schema.js')

    const client = await project.importClient<Schema>()

    expect(await client.getFoo(1)).toEqual(null)
  })

  test('create - pk conflict', async () => {
    const project = await createProject(
      {
        'sql/schema.sql': sql`
          CREATE TABLE "grocery_list" (
            list_id integer,
            item_id integer,
            name text NOT NULL,
            PRIMARY KEY (list_id, item_id)
          );
        `,
      },
      {
        plugins: ['@pg-nano/plugin-crud'],
      },
    )

    await project.generate()

    type Schema =
      typeof import('../__fixtures__/@pg-nano+plugin-crud__create_pk_conflict/sql/schema.js')

    const client = await project.importClient<Schema>()

    // Create first item successfully
    expect(
      await client.createGroceryList({ listId: 1, itemId: 1, name: 'Salad' }),
    ).toEqual({
      listId: 1,
      itemId: 1,
      name: 'Salad',
    })

    // Attempt to create second item with same primary key
    await expect(() =>
      client.createGroceryList({ listId: 1, itemId: 1, name: 'Cookies' }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`
      [PgResultError: ERROR:  duplicate key value violates unique constraint "grocery_list_pkey"
      DETAIL:  Key (list_id, item_id)=(1, 1) already exists.
      CONTEXT:  SQL statement "INSERT INTO "public"."grocery_list"
          VALUES ($1[1]::int4, $1[2]::int4, $1[3])
          RETURNING *"
      PL/pgSQL function create_grocery_list(text[]) line 6 at SQL statement
      ]
    `)
  })
})
