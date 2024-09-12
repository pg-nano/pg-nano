import { routineQueryAll, routineQueryOne, routineQueryOneValue, type JSON, type Point, type Range } from 'pg-nano'

export const AddressType = ["street", "city", "state", "zip_code"]

export const Foo = ["id", "name", "description", "created_at", "updated_at", "is_active", "score", "tags", "matrix", "metadata", "binary_data", "coordinates", "ip_address", "mac_address", "price_range", "schedule", "priority", "uuid", "search_vector", "status", { address: AddressType }, "product_attributes"]

export const Account = ["id", "username", "email", "password_hash", "first_name", "last_name", "date_of_birth", "created_at", "updated_at", "last_login", "is_deleted", "posts_count"]

export type StatusType = "pending" | "active" | "inactive" | "archived"

export type AddressType = {
  street?: string
  city?: string
  state?: string
  zip_code?: string
}

export type Foo = {
  id: number
  name: string
  description?: string
  created_at?: Date
  updated_at?: Date
  is_active?: boolean
  score?: string
  tags?: string[]
  matrix?: number[]
  metadata?: JSON
  binary_data?: Buffer
  coordinates?: Point
  ip_address?: string
  mac_address?: string
  price_range?: Range<number>
  schedule?: Range<Date>
  priority?: number
  uuid?: string
  search_vector?: unknown
  status?: StatusType
  address?: AddressType
  product_attributes?: unknown
}
export declare namespace Foo {
  type InsertParams = {
    name: string
    description?: string
    created_at?: Date
    updated_at?: Date
    is_active?: boolean
    score?: string
    tags?: string[]
    matrix?: number[]
    metadata?: JSON
    binary_data?: Buffer
    coordinates?: Point
    ip_address?: string
    mac_address?: string
    price_range?: Range<number>
    schedule?: Range<Date>
    priority?: number
    uuid?: string
    search_vector?: unknown
    status?: StatusType
    address?: AddressType
    product_attributes?: unknown
  }
}

export type Account = {
  id: number
  username: string
  email: string
  password_hash: string
  first_name?: string
  last_name?: string
  date_of_birth?: string
  created_at: Date
  updated_at: Date
  last_login?: Date
  is_deleted?: boolean
  posts_count: number
}
export declare namespace Account {
  type InsertParams = {
    id?: number
    username: string
    email: string
    password_hash: string
    first_name?: string
    last_name?: string
    date_of_birth?: string
    created_at?: Date
    updated_at?: Date
    last_login?: Date
    is_deleted?: boolean
    posts_count?: number
  }
}

export declare namespace replaceFoo {
  type Params = { id: number, rec: Foo.InsertParams }
  type Result = Foo
}

export const replaceFoo = /* @__PURE__ */ routineQueryOne<replaceFoo.Params, replaceFoo.Result>("replace_foo", ["id","rec"])

export declare namespace updateFoo {
  type Params = { id: number, data: JSON }
  type Result = Foo
}

export const updateFoo = /* @__PURE__ */ routineQueryOne<updateFoo.Params, updateFoo.Result>("update_foo", ["id","data"])

export declare namespace createPost {
  type Params = { title: string, content: string, authorId: number }
  type Result = void
}

export const createPost = /* @__PURE__ */ routineQueryOneValue<createPost.Params, createPost.Result>("create_post", ["title","content","authorId"])

export declare namespace createAccount {
  type Params = { username: string, email: string, password: string, salt: string, firstName?: string, lastName?: string, dateOfBirth?: string }
  type Result = number
}

export const createAccount = /* @__PURE__ */ routineQueryOneValue<createAccount.Params, createAccount.Result>("create_account", ["username","email","password","salt","firstName","lastName","dateOfBirth"])

export declare namespace deleteFoo {
  type Params = { id: number }
  type Result = boolean
}

export const deleteFoo = /* @__PURE__ */ routineQueryOneValue<deleteFoo.Params, deleteFoo.Result>("delete_foo", ["id"])

export declare namespace replaceAccount {
  type Params = { id: number, rec: Account.InsertParams }
  type Result = Account
}

export const replaceAccount = /* @__PURE__ */ routineQueryOne<replaceAccount.Params, replaceAccount.Result>("replace_account", ["id","rec"])

export declare namespace deleteAccount {
  type Params = [number]
  type Result = boolean
}

export const deleteAccount = /* @__PURE__ */ routineQueryOneValue<deleteAccount.Params, deleteAccount.Result>("delete_account")

export declare namespace getFoo {
  type Params = { id: number }
  type Result = Foo
}

export const getFoo = /* @__PURE__ */ routineQueryAll<getFoo.Params, getFoo.Result>("get_foo", ["id"])

export declare namespace upsertAccount {
  type Params = { rec: Account.InsertParams }
  type Result = Account
}

export const upsertAccount = /* @__PURE__ */ routineQueryOne<upsertAccount.Params, upsertAccount.Result>("upsert_account", ["rec"])

export declare namespace getAccount {
  type Params = { id: number }
  type Result = Account
}

export const getAccount = /* @__PURE__ */ routineQueryOne<getAccount.Params, getAccount.Result>("get_account", ["id"])

export declare namespace createFoo {
  type Params = { rec: Foo.InsertParams }
  type Result = Foo
}

export const createFoo = /* @__PURE__ */ routineQueryAll<createFoo.Params, createFoo.Result>("create_foo", ["rec"])

export declare namespace updateAccount {
  type Params = { id: number, data: JSON }
  type Result = Account
}

export const updateAccount = /* @__PURE__ */ routineQueryOne<updateAccount.Params, updateAccount.Result>("update_account", ["id","data"])

export declare namespace upsertFoo {
  type Params = { rec: Foo.InsertParams }
  type Result = Foo
}

export const upsertFoo = /* @__PURE__ */ routineQueryOne<upsertFoo.Params, upsertFoo.Result>("upsert_foo", ["rec"])
