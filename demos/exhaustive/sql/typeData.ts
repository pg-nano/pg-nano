import * as t from './typeData.js'

// Base types
export const bool = 16
export const bpchar = 1042
export const bytea = 17
export const date = 1082
export const float8_array = 1022
export const inet = 869
export const int2 = 21
export const int4 = 23
export const int4range = 3904
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

// Field mappers
export { update_mapper } from '@pg-nano/plugin-crud/field-mappers'

// Enum types
export const status_type = 3338343

// Composite types
export const course = {
  id: t.int4,
  courseName: t.varchar,
} as const

export const course_enrollment = {
  studentId: t.int4,
  courseId: t.int4,
  enrollmentDate: t.date,
  grade: t.bpchar,
} as const

export const address_type = {
  street: t.varchar,
  city: t.varchar,
  state: t.varchar,
  zipCode: t.varchar,
} as const

export const foo = {
  id: t.int4,
  name: t.varchar,
  description: t.text,
  createdAt: t.timestamptz,
  updatedAt: t.timestamptz,
  isActive: t.bool,
  score: t.numeric,
  tags: t.text_array,
  matrix: t.float8_array,
  metadata: t.jsonb,
  binaryData: t.bytea,
  coordinates: t.point,
  ipAddress: t.inet,
  macAddress: t.macaddr,
  priceRange: t.int4range,
  schedule: t.tstzrange,
  priority: t.int2,
  uuid: t.uuid,
  searchVector: t.tsvector,
  status: 3338343 /* status_type */,
  address: t.address_type,
  productAttributes: 3338215 /* unknown */,
  colorPreference: t.varchar,
} as const

export const student = {
  id: t.int4,
  firstName: t.varchar,
  lastName: t.varchar,
} as const

export const account = {
  id: t.int4,
  username: t.varchar,
  email: t.varchar,
  passwordHash: t.varchar,
  postsCount: t.int4,
  firstName: t.varchar,
  lastName: t.varchar,
  dateOfBirth: t.date,
  createdAt: t.timestamptz,
  updatedAt: t.timestamptz,
  lastLogin: t.timestamptz,
  isDeleted: t.bool,
} as const

export const post = {
  id: t.int4,
  title: t.varchar,
  content: t.text,
  authorId: t.int4,
  createdAt: t.timestamptz,
  updatedAt: t.timestamptz,
} as const
