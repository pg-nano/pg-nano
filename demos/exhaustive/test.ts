import { Client, FieldCase } from 'pg-nano'
import * as schema from '../sql/schema.js'

const client = new Client({
  fieldCase: FieldCase.camel,
}).withSchema(schema)
