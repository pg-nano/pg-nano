import * as t from './types.js'

// Base types
export const bool = 16
export const bytea = 17
export const date = 1082
export const float8_array = 1022
export const hstore = 3338215
export const inet = 869
export const int2 = 21
export const int4 = 23
export const int4range = 3904
export const json = 114
export const jsonb = 3802
export const macaddr = 829
export const numeric = 1700
export const point = 600
export const text = 25
export const text_array = 1009
export const timestamptz = 1184
export const tstzrange = 3910
export const tsvector = 3614
export const uuid = 2950
export const varchar = 1043

// Enum types
export const status_type = 3338343

// Composite types
export const address_type = {
  street: t.varchar,
  city: t.varchar,
  state: t.varchar,
  zip_code: t.varchar
} as const

export const foo = {
  id: t.int4,
  name: t.varchar,
  description: t.text,
  created_at: t.timestamptz,
  updated_at: t.timestamptz,
  is_active: t.bool,
  score: t.numeric,
  tags: t.text_array,
  matrix: t.float8_array,
  metadata: t.jsonb,
  binary_data: t.bytea,
  coordinates: t.point,
  ip_address: t.inet,
  mac_address: t.macaddr,
  price_range: t.int4range,
  schedule: t.tstzrange,
  priority: t.int2,
  uuid: t.uuid,
  search_vector: t.tsvector,
  status: 3338343 /* status_type */,
  address: t.address_type,
  product_attributes: t.hstore
} as const

export const account = {
  id: t.int4,
  username: t.varchar,
  email: t.varchar,
  password_hash: t.varchar,
  first_name: t.varchar,
  last_name: t.varchar,
  date_of_birth: t.date,
  created_at: t.timestamptz,
  updated_at: t.timestamptz,
  last_login: t.timestamptz,
  is_deleted: t.bool,
  posts_count: t.int4
} as const
