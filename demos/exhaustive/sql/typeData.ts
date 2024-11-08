/* BEWARE: This file was generated by pg-nano. Any changes you make will be overwritten. */
import * as t from './typeData.js'

export { defineArrayMapper as array, defineRowMapper as row } from 'pg-nano'

// Field mappers
export { insert_mapper } from '@pg-nano/plugin-crud/field-mappers'
export { update_mapper } from '@pg-nano/plugin-crud/field-mappers'

// Composite types
export const course = /* @__PURE__ */ t.row(['id', 'course_name'])

export const course_enrollment = /* @__PURE__ */ t.row([
  'student_id',
  'course_id',
  'enrollment_date',
  'grade',
])

export const address_type = /* @__PURE__ */ t.row([
  'street',
  'city',
  'state',
  'zip_code',
])

export const foo = /* @__PURE__ */ t.row(
  [
    'id',
    'name',
    'description',
    'created_at',
    'updated_at',
    'is_active',
    'score',
    'tags',
    'matrix',
    'metadata',
    'color_preference',
    'binary_data',
    'coordinates',
    'ip_address',
    'mac_address',
    'price_range',
    'schedule',
    'priority',
    'uuid',
    'search_vector',
    'status',
    'address',
    'product_attributes',
  ],
  { address: t.address_type },
)

export const student = /* @__PURE__ */ t.row(['id', 'first_name', 'last_name'])

export const account = /* @__PURE__ */ t.row([
  'id',
  'username',
  'email',
  'password_hash',
  'posts_count',
  'first_name',
  'last_name',
  'date_of_birth',
  'created_at',
  'updated_at',
  'last_login',
  'is_deleted',
])

export const post = /* @__PURE__ */ t.row([
  'id',
  'title',
  'content',
  'author_id',
  'created_at',
  'updated_at',
])
