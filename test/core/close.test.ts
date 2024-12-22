import { sleep } from 'radashi'
import { bufferReadable, spawn } from 'test/util.js'
import { spawnTempDatabase } from './util.js'

const db = spawnTempDatabase()

test('Client.prototype.close', async () => {
  let count = await countConnections()
  expect(count).toBe(0)

  const client = await db.connect({
    minConnections: 3,
  })

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
  const proc = spawn('psql', [db.dsn, '--no-psqlrc', '-At', '-c', query])
  if (!proc.stdout) {
    throw new Error('No stdout')
  }
  const stdout = await bufferReadable<string>(proc.stdout, 'utf-8')
  return Number(stdout.trim() || 0)
}
