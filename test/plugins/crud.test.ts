import { createProject, dedent, resetPublicSchema } from '../util.js'

const sql = dedent

describe('@pg-nano/plugin-crud', () => {
  beforeEach(resetPublicSchema)

  test('basic cases', async () => {
    const project = await createProject(
      {
        'sql/schema.sql': sql`
          CREATE TABLE "user" (
            id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
            name text NOT NULL,
            tags text[] DEFAULT '{}'
          );

          CREATE TABLE "book" (
            sku text PRIMARY KEY,
            title text NOT NULL
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
      id: 1n, // <== generated id
      name: 'John',
      tags: [], // <== default value
    })

    // Get a record
    expect(await client.getUser(1)).toEqual({
      id: 1n,
      name: 'John',
      tags: [],
    })

    // Update a record
    expect(await client.updateUser(1, { name: 'Jonny' })).toEqual({
      id: 1n,
      name: 'Jonny',
      tags: [],
    })

    // Verify update
    expect(await client.getUser(1)).toEqual({
      id: 1n,
      name: 'Jonny',
      tags: [],
    })

    // Delete a record
    expect(await client.deleteUser(1)).toEqual(true)

    // Verify deletion
    expect(await client.getUser(1)).toEqual(null)

    // Upsert a non-existent record
    expect(
      await client.upsertBook({
        sku: 'abc',
        title: 'The Art of Computer Programming',
      }),
    ).toEqual({
      sku: 'abc',
      title: 'The Art of Computer Programming',
    })

    // Verify upsert
    expect(await client.getBook('abc')).toEqual({
      sku: 'abc',
      title: 'The Art of Computer Programming',
    })

    // Upsert an existing record
    expect(
      await client.upsertBook({
        sku: 'abc',
        title: 'The Art of Computer Programming Vol. 1',
      }),
    ).toEqual({
      sku: 'abc',
      title: 'The Art of Computer Programming Vol. 1',
    })

    // Verify upsert
    expect(await client.getBook('abc')).toEqual({
      sku: 'abc',
      title: 'The Art of Computer Programming Vol. 1',
    })
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
