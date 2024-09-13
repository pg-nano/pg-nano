import { Client, FieldCase } from 'pg-nano'
import * as schema from './sql/schema.js'

const client = new Client({
  fieldCase: FieldCase.camel,
}).withSchema(schema)

await client.connect('postgres://postgres:postgres@localhost:5432/postgres')

await client.dropAccountNamed('alec')

const accountId = await client.createAccount({
  email: 'alec@larson.com',
  username: 'alec',
  password: 'password',
  salt: 'salt',
})

console.log('accountId =>', accountId)

const updatedAccount = await client.updateAccount({
  id: accountId,
  data: {
    dateOfBirth: '1994-05-01',
  },
})

console.log('updatedAccount =>', updatedAccount)
