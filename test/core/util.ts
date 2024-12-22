import * as pgtmp from '@pg-nano/pg-tmp'
import { Client, type ClientConfig } from 'pg-nano'
import { isFunction } from 'radashi'

export async function getClient(config?: Partial<ClientConfig>) {
  const client = new Client(config)
  onTestFinished(async () => {
    await client.close()
  })
  await client.connect(process.env.PG_TMP_DSN!)
  return client
}

export function getClientFactory(config?: Partial<ClientConfig>) {
  let client: Client

  beforeEach(async () => {
    client = await new Client(config).connect(process.env.PG_TMP_DSN!)
  })

  afterEach(async () => {
    await client.close()
  })

  return () => client
}

export type TempDatabase = {
  get dsn(): string
  connect(config?: Partial<ClientConfig>): Promise<Client>
}

export function spawnTempDatabase(): TempDatabase
export function spawnTempDatabase(client: Client): Client
export function spawnTempDatabase(clientFactory: () => Client): () => Client
export function spawnTempDatabase(
  clientFactory?: Client | (() => Client),
): any {
  let client: Client | undefined
  let dataDir: string
  let dsn: string

  beforeEach(async () => {
    dataDir = await pgtmp.initdb()
    dsn = await pgtmp.start({ dataDir })
    client = isFunction(clientFactory) ? clientFactory() : clientFactory
    await client?.connect(dsn)
  })

  afterEach(async () => {
    await client?.close()
    await pgtmp.stop(dataDir, { force: true })
  })

  if (isFunction(clientFactory)) {
    return () => client
  }
  if (clientFactory) {
    return clientFactory
  }
  return {
    get dsn() {
      return dsn
    },
    connect(config?: ClientConfig) {
      return new Client(config).connect(dsn)
    },
  }
}
