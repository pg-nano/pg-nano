import { declareRoutine, declareScalarRoutine, type JSON, type Point, type Range } from 'pg-nano'

export type StatusType = "pending" | "active" | "inactive" | "archived"

export interface Account {
  created_at: Date
  updated_at: Date
  last_login: Date
  id: number
  date_of_birth: string
  is_deleted: boolean
  username: string
  email: string
  password_hash: string
  first_name: string
  last_name: string
}

export interface Post {
  created_at: Date
  updated_at: Date
  id: number
  author_id: number
  title: string
  content: string
}

export interface AddressType {
  street: string
  city: string
  state: string
  zip_code: string
}

export interface Foo {
  address: AddressType
  binary_data: Buffer
  coordinates: Point
  created_at: Date
  description: string
  id: number
  ip_address: string
  is_active: boolean
  mac_address: string
  matrix: number[]
  metadata: JSON
  name: string
  price_range: Range<number>
  priority: number
  product_attributes: unknown
  schedule: Range<Date>
  score: string
  search_vector: unknown
  status: StatusType
  tags: string[]
  updated_at: Date
  uuid: string
}

export interface CourseEnrollment {
  student_id: number
  course_id: number
  enrollment_date: string
  grade: string
}

export declare namespace createAccount {
  export type Params = {username: string, email: string, password: string, salt: string, firstName?: string, lastName?: string, dateOfBirth?: string}
  export type Result = number
}

export const createAccount = declareScalarRoutine<createAccount.Params, createAccount.Result>("create_account", ["username","email","password","salt","firstName","lastName","dateOfBirth"])

export declare namespace getFoo {
  export type Params = {id: number}
  export type Result = Foo
}

export const getFoo = declareRoutine<getFoo.Params, getFoo.Result>("get_foo", ["id"])

export declare namespace deleteAccount {
  export type Params = [number]
  export type Result = boolean
}

export const deleteAccount = declareScalarRoutine<deleteAccount.Params, deleteAccount.Result>("delete_account")
