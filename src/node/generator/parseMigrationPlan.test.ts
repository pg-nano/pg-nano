import { Readable } from 'node:stream'
import { test } from 'vitest'
import { parseMigrationPlan } from './parseMigrationPlan'

test('parsePlan', async () => {
  const examplePlan = `
################################## Review plan ##################################
1. ALTER TABLE "public"."test" DROP COLUMN "matrix";
        -- Statement Timeout: 3s
        -- Hazard DELETES_DATA: Deletes all values in the column

############################# Executing statement 1 #############################
ALTER TABLE "public"."test" DROP COLUMN "matrix";
        -- Statement Timeout: 3s
        -- Hazard DELETES_DATA: Deletes all values in the column

Finished executing statement. Duration: 1.305396ms
################################### Complete ###################################
Schema applied successfully`

  for await (const plan of parseMigrationPlan(
    stringToReadableStream(examplePlan.trim()),
  )) {
    console.log(plan)
  }
})

// Convert a string to a readable stream, limiting the chunk size to 10
// characters to simulate a real-world scenario.
function stringToReadableStream(input: string): Readable {
  let index = 0
  return new Readable({
    read() {
      if (index < input.length) {
        this.push(input.slice(index, index + 10))
        index += 10
      } else {
        this.push(null)
      }
    },
  })
}
