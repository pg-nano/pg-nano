import { dedent, TestProject } from '../util.js'

const sql = dedent

describe('generate', () => {
  test('zero argument routine', async () => {
    const project = new TestProject({
      fixtures: {
        'sql/schema.sql': sql`
          CREATE FUNCTION forty_two() RETURNS int AS $$
          BEGIN
            RETURN 42;
          END;
          $$ LANGUAGE plpgsql;
        `,
      },
    })

    await project.update()
    expect(project.readGeneratedFiles()).toMatchSnapshot()

    type Schema =
      typeof import('../__fixtures__/generate__zero_argument_routine/sql/schema.ts')

    const client = await project.importClient<Schema>()

    expect(await client.fortyTwo()).toBe(42)
  })

  test('one argument routine', async () => {
    const project = new TestProject({
      fixtures: {
        'sql/schema.sql': sql`
          CREATE FUNCTION multiply_by_2(x int) RETURNS int AS $$
          BEGIN
            RETURN x * 2;
          END;
          $$ LANGUAGE plpgsql;
        `,
      },
    })

    await project.update()
    expect(project.readGeneratedFiles()).toMatchSnapshot()

    type Schema =
      typeof import('../__fixtures__/generate__one_argument_routine/sql/schema.ts')

    const client = await project.importClient<Schema>()

    expect(await client.multiplyBy2(21)).toBe(42)
  })
})
