import { declareRoutine, declareScalarRoutine, type Point, type Range } from 'pg-nano'

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

export interface Foo {
  uuid: string
  coordinates: Point
  updated_at: Date
  created_at: Date
  mac_address: string
  id: number
  priority: number
  is_active: boolean
  ip_address: string
  binary_data: Buffer
  description: string
  metadata: unknown
  tags: string[]
  price_range: Range<number>
  schedule: Range<Date>
  score: string
  name: string
  search_vector: unknown
  matrix: number[]
  status: StatusType
  product_attributes: unknown
  address: unknown
}

export interface AddressType {
  street: string
  city: string
  state: string
  zip_code: string
}

export declare namespace createAccount {
  export type Params = {username: string, email: string, password: string, salt: string, firstName?: string, lastName?: string, dateOfBirth?: string}
  export type Result = number
}

export const createAccount = declareScalarRoutine<createAccount.Params, createAccount.Result>("create_account", ["username","email","password","salt","firstName","lastName","dateOfBirth"])

export declare namespace getFoo {
  export type Params = {id: number}
  export type Result = {uuid: string, coordinates: Point, updated_at: Date, created_at: Date, mac_address: string, id: number, priority: number, is_active: boolean, ip_address: string, binary_data: Buffer, description: string, metadata: unknown, tags: string[], price_range: Range<number>, schedule: Range<Date>, score: string, name: string, search_vector: unknown, matrix: number[], status: StatusType, product_attributes: unknown, address: AddressType}
}

export const getFoo = declareRoutine<getFoo.Params, getFoo.Result>("get_foo", ["id"])

export declare namespace deleteAccount {
  export type Params = [number]
  export type Result = boolean
}

export const deleteAccount = declareScalarRoutine<deleteAccount.Params, deleteAccount.Result>("delete_account")
