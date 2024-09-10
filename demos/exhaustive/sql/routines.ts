import { routineQueryAll, routineQueryOne, routineQueryOneValue, type JSON, type Point, type Range } from 'pg-nano'

export type StatusType = "pending" | "active" | "inactive" | "archived"

export type AddressType = {
  street?: string
  city?: string
  state?: string
  zip_code?: string
}

export type CourseEnrollment = {
  student_id: number
  course_id: number
  enrollment_date?: string
  grade?: string
}
export declare namespace CourseEnrollment {
  type InsertParams = {
    student_id: number
    course_id: number
    enrollment_date?: string
    grade?: string
  }
}

export type Post = {
  id: number
  title: string
  content?: string
  author_id?: number
  created_at?: Date
  updated_at?: Date
}
export declare namespace Post {
  type InsertParams = {
    id?: number
    title: string
    content?: string
    author_id?: number
    created_at?: Date
    updated_at?: Date
  }
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

export declare namespace deleteCourseEnrollment {
  type Params = { studentId: number, courseId: number }
  type Result = boolean
}

export const deleteCourseEnrollment = /* @__PURE__ */ routineQueryOneValue<deleteCourseEnrollment.Params, deleteCourseEnrollment.Result>("delete_course_enrollment", ["studentId","courseId"])

export declare namespace deletePost {
  type Params = { id: number }
  type Result = boolean
}

export const deletePost = /* @__PURE__ */ routineQueryOneValue<deletePost.Params, deletePost.Result>("delete_post", ["id"])

export declare namespace replaceCourseEnrollment {
  type Params = { studentId: number, courseId: number, rec: CourseEnrollment.InsertParams }
  type Result = CourseEnrollment
}

export const replaceCourseEnrollment = /* @__PURE__ */ routineQueryOne<replaceCourseEnrollment.Params, replaceCourseEnrollment.Result>("replace_course_enrollment", ["studentId","courseId","rec"])

export declare namespace createPost {
  type Params = { title: string, content: string, authorId: number }
  type Result = void
}

export const createPost = /* @__PURE__ */ routineQueryOneValue<createPost.Params, createPost.Result>("create_post", ["title","content","authorId"])

export declare namespace getCourseEnrollment {
  type Params = { studentId: number, courseId: number }
  type Result = CourseEnrollment
}

export const getCourseEnrollment = /* @__PURE__ */ routineQueryOne<getCourseEnrollment.Params, getCourseEnrollment.Result>("get_course_enrollment", ["studentId","courseId"])

export declare namespace insertPost {
  type Params = { rec: Post.InsertParams }
  type Result = Post
}

export const insertPost = /* @__PURE__ */ routineQueryAll<insertPost.Params, insertPost.Result>("insert_post", ["rec"])

export declare namespace createAccount {
  type Params = { username: string, email: string, password: string, salt: string, firstName?: string, lastName?: string, dateOfBirth?: string }
  type Result = number
}

export const createAccount = /* @__PURE__ */ routineQueryOneValue<createAccount.Params, createAccount.Result>("create_account", ["username","email","password","salt","firstName","lastName","dateOfBirth"])

export declare namespace countPosts {
  type Params = { conditions: JSON }
  type Result = string
}

export const countPosts = /* @__PURE__ */ routineQueryOneValue<countPosts.Params, countPosts.Result>("count_posts", ["conditions"])

export declare namespace countCourseEnrollments {
  type Params = { conditions: JSON }
  type Result = string
}

export const countCourseEnrollments = /* @__PURE__ */ routineQueryOneValue<countCourseEnrollments.Params, countCourseEnrollments.Result>("count_course_enrollments", ["conditions"])

export declare namespace getPost {
  type Params = { id: number }
  type Result = Post
}

export const getPost = /* @__PURE__ */ routineQueryOne<getPost.Params, getPost.Result>("get_post", ["id"])

export declare namespace updateCourseEnrollment {
  type Params = { studentId: number, courseId: number, data: JSON }
  type Result = CourseEnrollment
}

export const updateCourseEnrollment = /* @__PURE__ */ routineQueryOne<updateCourseEnrollment.Params, updateCourseEnrollment.Result>("update_course_enrollment", ["studentId","courseId","data"])

export declare namespace replaceAccount {
  type Params = { id: number, rec: Account.InsertParams }
  type Result = Account
}

export const replaceAccount = /* @__PURE__ */ routineQueryOne<replaceAccount.Params, replaceAccount.Result>("replace_account", ["id","rec"])

export declare namespace upsertPost {
  type Params = { rec: Post.InsertParams }
  type Result = Post
}

export const upsertPost = /* @__PURE__ */ routineQueryOne<upsertPost.Params, upsertPost.Result>("upsert_post", ["rec"])

export declare namespace deleteAccount {
  type Params = [number]
  type Result = boolean
}

export const deleteAccount = /* @__PURE__ */ routineQueryOneValue<deleteAccount.Params, deleteAccount.Result>("delete_account")

export declare namespace listAccounts {
  type Params = { conditions: JSON }
  type Result = Account
}

export const listAccounts = /* @__PURE__ */ routineQueryAll<listAccounts.Params, listAccounts.Result>("list_accounts", ["conditions"])

export declare namespace countAccounts {
  type Params = { conditions: JSON }
  type Result = string
}

export const countAccounts = /* @__PURE__ */ routineQueryOneValue<countAccounts.Params, countAccounts.Result>("count_accounts", ["conditions"])

export declare namespace upsertCourseEnrollment {
  type Params = { rec: CourseEnrollment.InsertParams }
  type Result = CourseEnrollment
}

export const upsertCourseEnrollment = /* @__PURE__ */ routineQueryOne<upsertCourseEnrollment.Params, upsertCourseEnrollment.Result>("upsert_course_enrollment", ["rec"])

export declare namespace updatePost {
  type Params = { id: number, data: JSON }
  type Result = Post
}

export const updatePost = /* @__PURE__ */ routineQueryOne<updatePost.Params, updatePost.Result>("update_post", ["id","data"])

export declare namespace getFoo {
  type Params = { id: number }
  type Result = Foo
}

export const getFoo = /* @__PURE__ */ routineQueryAll<getFoo.Params, getFoo.Result>("get_foo", ["id"])

export declare namespace findAccount {
  type Params = { conditions: JSON }
  type Result = Account
}

export const findAccount = /* @__PURE__ */ routineQueryOne<findAccount.Params, findAccount.Result>("find_account", ["conditions"])

export declare namespace findPost {
  type Params = { conditions: JSON }
  type Result = Post
}

export const findPost = /* @__PURE__ */ routineQueryOne<findPost.Params, findPost.Result>("find_post", ["conditions"])

export declare namespace findCourseEnrollment {
  type Params = { conditions: JSON }
  type Result = CourseEnrollment
}

export const findCourseEnrollment = /* @__PURE__ */ routineQueryOne<findCourseEnrollment.Params, findCourseEnrollment.Result>("find_course_enrollment", ["conditions"])

export declare namespace insertAccount {
  type Params = { rec: Account.InsertParams }
  type Result = Account
}

export const insertAccount = /* @__PURE__ */ routineQueryAll<insertAccount.Params, insertAccount.Result>("insert_account", ["rec"])

export declare namespace insertCourseEnrollment {
  type Params = { rec: CourseEnrollment.InsertParams }
  type Result = CourseEnrollment
}

export const insertCourseEnrollment = /* @__PURE__ */ routineQueryAll<insertCourseEnrollment.Params, insertCourseEnrollment.Result>("insert_course_enrollment", ["rec"])

export declare namespace getAccount {
  type Params = { id: number }
  type Result = Account
}

export const getAccount = /* @__PURE__ */ routineQueryOne<getAccount.Params, getAccount.Result>("get_account", ["id"])

export declare namespace listCourseEnrollments {
  type Params = { conditions: JSON }
  type Result = CourseEnrollment
}

export const listCourseEnrollments = /* @__PURE__ */ routineQueryAll<listCourseEnrollments.Params, listCourseEnrollments.Result>("list_course_enrollments", ["conditions"])

export declare namespace replacePost {
  type Params = { id: number, rec: Post.InsertParams }
  type Result = Post
}

export const replacePost = /* @__PURE__ */ routineQueryOne<replacePost.Params, replacePost.Result>("replace_post", ["id","rec"])

export declare namespace upsertAccount {
  type Params = { rec: Account.InsertParams }
  type Result = Account
}

export const upsertAccount = /* @__PURE__ */ routineQueryOne<upsertAccount.Params, upsertAccount.Result>("upsert_account", ["rec"])

export declare namespace listPosts {
  type Params = { conditions: JSON }
  type Result = Post
}

export const listPosts = /* @__PURE__ */ routineQueryAll<listPosts.Params, listPosts.Result>("list_posts", ["conditions"])

export declare namespace updateAccount {
  type Params = { id: number, data: JSON }
  type Result = Account
}

export const updateAccount = /* @__PURE__ */ routineQueryOne<updateAccount.Params, updateAccount.Result>("update_account", ["id","data"])
