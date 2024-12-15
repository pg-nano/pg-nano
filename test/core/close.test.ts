import * as pgtmp from '@pg-nano/pg-tmp'
import { Client } from 'pg-nano'
import { sleep } from 'radashi'
import { bufferReadable, spawn } from 'test/util.js'

let dataDir: string
let dsn: string

beforeAll(async () => {
  dataDir = await pgtmp.initdb()
  dsn = await pgtmp.start({ dataDir })
})

afterAll(async () => {
  await pgtmp.stop(dataDir, { force: true })
})

test('Client.prototype.close', async () => {
  let count = await countConnections()
  expect(count).toBe(0)

  const client = new Client({ minConnections: 3 })
  await client.connect(dsn)

  // Wait for all of the connections to be established.
  while (true) {
    count = await countConnections()
    if (count === 3) {
      break
    }
    await sleep(100)
  }

  await client.close()

  count = await countConnections()
  expect(count).toBe(0)
})

async function countConnections() {
  const query = /* sql */ `
    SELECT count(*) FROM pg_stat_activity
    WHERE datname IS NOT NULL
    AND state IS NOT NULL
    AND pid <> pg_backend_pid();
  `
  const proc = spawn('psql', [dsn, '--no-psqlrc', '-At', '-c', query])
  if (!proc.stdout) {
    throw new Error('No stdout')
  }
  const stdout = await bufferReadable<string>(proc.stdout, 'utf-8')
  return Number(stdout.trim() || 0)
}
