import { bindQueryRow, bindQueryRowList, bindQueryValue, type JSON, type Point, type Range, type Timestamp } from 'pg-nano'
import * as t from './types.js'

export type StatusType = "pending" | "active" | "inactive" | "archived"

export type AddressType = {
  street?: string
  city?: string
  state?: string
  zipCode?: string
}

export type Post = {
  id: number
  title: string
  content?: string
  authorId?: number
  createdAt?: Timestamp
  updatedAt?: Timestamp
}
export declare namespace Post {
  type InsertParams = {
    id?: number
    title: string
    content?: string
    authorId?: number
    createdAt?: Timestamp
    updatedAt?: Timestamp
  }
}

export type CourseEnrollment = {
  studentId: number
  courseId: number
  enrollmentDate: string
  grade?: string
}
export declare namespace CourseEnrollment {
  type InsertParams = {
    studentId: number
    courseId: number
    enrollmentDate: string
    grade?: string
  }
}

export type Foo = {
  id: number
  name: string
  description?: string
  createdAt: Timestamp
  updatedAt: Timestamp
  isActive: boolean
  score?: string
  tags?: string[]
  matrix?: number[]
  metadata?: JSON
  binaryData?: Buffer
  coordinates?: Point
  ipAddress?: string
  macAddress?: string
  priceRange?: Range<number>
  schedule?: Range<Timestamp>
  priority?: number
  uuid?: string
  searchVector?: unknown
  status?: StatusType
  address?: AddressType
  productAttributes?: unknown
  colorPreference?: string
}
export declare namespace Foo {
  type InsertParams = {
    name: string
    description?: string
    createdAt?: Timestamp
    updatedAt?: Timestamp
    isActive?: boolean
    score?: string
    tags?: string[]
    matrix?: number[]
    metadata?: JSON
    binaryData?: Buffer
    coordinates?: Point
    ipAddress?: string
    macAddress?: string
    priceRange?: Range<number>
    schedule?: Range<Timestamp>
    priority?: number
    uuid?: string
    searchVector?: unknown
    status?: StatusType
    address?: AddressType
    productAttributes?: unknown
    colorPreference?: string
  }
}

export type Account = {
  id: number
  username: string
  email: string
  passwordHash: string
  firstName?: string
  lastName?: string
  dateOfBirth?: string
  createdAt: Timestamp
  updatedAt: Timestamp
  lastLogin?: Timestamp
  isDeleted?: boolean
  postsCount: number
}
export declare namespace Account {
  type InsertParams = {
    id?: number
    username: string
    email: string
    passwordHash: string
    firstName?: string
    lastName?: string
    dateOfBirth?: string
    createdAt?: Timestamp
    updatedAt?: Timestamp
    lastLogin?: Timestamp
    isDeleted?: boolean
    postsCount?: number
  }
}

export type Student = {
  id: number
  firstName: string
  lastName: string
}
export declare namespace Student {
  type InsertParams = {
    firstName: string
    lastName: string
  }
}

export type Course = {
  id: number
  courseName: string
}
export declare namespace Course {
  type InsertParams = {
    courseName: string
  }
}

export declare namespace updateStudent {
  type Params = { id: number, entries: string[] }
  type Result = Student
}

export const updateStudent = /* @__PURE__ */ bindQueryRow<updateStudent.Params, updateStudent.Result>("update_student", { id: t.int4, entries: t.text_array })

export declare namespace updateCourseEnrollment {
  type Params = { studentId: number, courseId: number, entries: string[] }
  type Result = CourseEnrollment
}

export const updateCourseEnrollment = /* @__PURE__ */ bindQueryRow<updateCourseEnrollment.Params, updateCourseEnrollment.Result>("update_course_enrollment", { studentId: t.int4, courseId: t.int4, entries: t.text_array })

export declare namespace replaceStudent {
  type Params = { id: number, rec: Student.InsertParams }
  type Result = Student
}

export const replaceStudent = /* @__PURE__ */ bindQueryRow<replaceStudent.Params, replaceStudent.Result>("replace_student", { id: t.int4, rec: t.student })

export declare namespace replaceCourseEnrollment {
  type Params = { studentId: number, courseId: number, rec: CourseEnrollment.InsertParams }
  type Result = CourseEnrollment
}

export const replaceCourseEnrollment = /* @__PURE__ */ bindQueryRow<replaceCourseEnrollment.Params, replaceCourseEnrollment.Result>("replace_course_enrollment", { studentId: t.int4, courseId: t.int4, rec: t.course_enrollment })

export declare namespace replaceCourse {
  type Params = { id: number, rec: Course.InsertParams }
  type Result = Course
}

export const replaceCourse = /* @__PURE__ */ bindQueryRow<replaceCourse.Params, replaceCourse.Result>("replace_course", { id: t.int4, rec: t.course })

export declare namespace replacePost {
  type Params = { id: number, rec: Post.InsertParams }
  type Result = Post
}

export const replacePost = /* @__PURE__ */ bindQueryRow<replacePost.Params, replacePost.Result>("replace_post", { id: t.int4, rec: t.post })

export declare namespace deleteFoo {
  type Params = { id: number }
  type Result = boolean
}

export const deleteFoo = /* @__PURE__ */ bindQueryValue<deleteFoo.Params, deleteFoo.Result>("delete_foo", { id: t.int4 })

export declare namespace createPost {
  type Params = { title: string, content: string, authorId: number }
  type Result = void
}

export const createPost = /* @__PURE__ */ bindQueryValue<createPost.Params, createPost.Result>("create_post", { title: t.text, content: t.text, authorId: t.int4 })

export declare namespace upsertAccount {
  type Params = [Account.InsertParams]
  type Result = Account
}

export const upsertAccount = /* @__PURE__ */ bindQueryRow<upsertAccount.Params, upsertAccount.Result>("upsert_account", [t.account])

export declare namespace updatePost {
  type Params = { id: number, entries: string[] }
  type Result = Post
}

export const updatePost = /* @__PURE__ */ bindQueryRow<updatePost.Params, updatePost.Result>("update_post", { id: t.int4, entries: t.text_array })

export declare namespace createFoo {
  type Params = [Foo.InsertParams]
  type Result = Foo
}

export const createFoo = /* @__PURE__ */ bindQueryRowList<createFoo.Params, createFoo.Result>("create_foo", [t.foo], { address: t.address_type })

export declare namespace getCourse {
  type Params = { id: number }
  type Result = Course
}

export const getCourse = /* @__PURE__ */ bindQueryRow<getCourse.Params, getCourse.Result>("get_course", { id: t.int4 })

export declare namespace deleteStudent {
  type Params = { id: number }
  type Result = boolean
}

export const deleteStudent = /* @__PURE__ */ bindQueryValue<deleteStudent.Params, deleteStudent.Result>("delete_student", { id: t.int4 })

export declare namespace createStudent {
  type Params = [Student.InsertParams]
  type Result = Student
}

export const createStudent = /* @__PURE__ */ bindQueryRowList<createStudent.Params, createStudent.Result>("create_student", [t.student])

export declare namespace createAccount {
  type Params = { username: string, email: string, password: string, salt: string, firstName?: string, lastName?: string, dateOfBirth?: string }
  type Result = number
}

export const createAccount = /* @__PURE__ */ bindQueryValue<createAccount.Params, createAccount.Result>("create_account", { username: t.varchar, email: t.varchar, password: t.varchar, salt: t.varchar, firstName: t.varchar, lastName: t.varchar, dateOfBirth: t.date })

export declare namespace replaceAccount {
  type Params = { id: number, rec: Account.InsertParams }
  type Result = Account
}

export const replaceAccount = /* @__PURE__ */ bindQueryRow<replaceAccount.Params, replaceAccount.Result>("replace_account", { id: t.int4, rec: t.account })

export declare namespace getStudent {
  type Params = { id: number }
  type Result = Student
}

export const getStudent = /* @__PURE__ */ bindQueryRow<getStudent.Params, getStudent.Result>("get_student", { id: t.int4 })

export declare namespace calculateGpa {
  type Params = { studentId: number }
  type Result = { totalGpa: string }
}

export const calculateGpa = /* @__PURE__ */ bindQueryRow<calculateGpa.Params, calculateGpa.Result>("calculate_gpa", { studentId: t.int4 })

export declare namespace upsertStudent {
  type Params = [Student.InsertParams]
  type Result = Student
}

export const upsertStudent = /* @__PURE__ */ bindQueryRow<upsertStudent.Params, upsertStudent.Result>("upsert_student", [t.student])

export declare namespace deleteCourseEnrollment {
  type Params = { studentId: number, courseId: number }
  type Result = boolean
}

export const deleteCourseEnrollment = /* @__PURE__ */ bindQueryValue<deleteCourseEnrollment.Params, deleteCourseEnrollment.Result>("delete_course_enrollment", { studentId: t.int4, courseId: t.int4 })

export declare namespace upsertPost {
  type Params = [Post.InsertParams]
  type Result = Post
}

export const upsertPost = /* @__PURE__ */ bindQueryRow<upsertPost.Params, upsertPost.Result>("upsert_post", [t.post])

export declare namespace deleteAccount {
  type Params = [number]
  type Result = boolean
}

export const deleteAccount = /* @__PURE__ */ bindQueryValue<deleteAccount.Params, deleteAccount.Result>("delete_account", [t.int4])

export declare namespace replaceFoo {
  type Params = { id: number, rec: Foo.InsertParams }
  type Result = Foo
}

export const replaceFoo = /* @__PURE__ */ bindQueryRow<replaceFoo.Params, replaceFoo.Result>("replace_foo", { id: t.int4, rec: t.foo }, { address: t.address_type })

export declare namespace getFoo {
  type Params = { id: number }
  type Result = Foo
}

export const getFoo = /* @__PURE__ */ bindQueryRowList<getFoo.Params, getFoo.Result>("get_foo", { id: t.int4 }, { address: t.address_type })

export declare namespace getPost {
  type Params = { id: number }
  type Result = Post
}

export const getPost = /* @__PURE__ */ bindQueryRow<getPost.Params, getPost.Result>("get_post", { id: t.int4 })

export declare namespace getAccount {
  type Params = { id: number }
  type Result = Account
}

export const getAccount = /* @__PURE__ */ bindQueryRow<getAccount.Params, getAccount.Result>("get_account", { id: t.int4 })

export declare namespace updateCourse {
  type Params = { id: number, entries: string[] }
  type Result = Course
}

export const updateCourse = /* @__PURE__ */ bindQueryRow<updateCourse.Params, updateCourse.Result>("update_course", { id: t.int4, entries: t.text_array })

export declare namespace dropAccountNamed {
  type Params = { username: string }
  type Result = void
}

export const dropAccountNamed = /* @__PURE__ */ bindQueryValue<dropAccountNamed.Params, dropAccountNamed.Result>("drop_account_named", { username: t.varchar })

export declare namespace updateFoo {
  type Params = { id: number, entries: string[] }
  type Result = Foo
}

export const updateFoo = /* @__PURE__ */ bindQueryRow<updateFoo.Params, updateFoo.Result>("update_foo", { id: t.int4, entries: t.text_array }, { address: t.address_type })

export declare namespace createCourse {
  type Params = [Course.InsertParams]
  type Result = Course
}

export const createCourse = /* @__PURE__ */ bindQueryRowList<createCourse.Params, createCourse.Result>("create_course", [t.course])

export declare namespace deleteCourse {
  type Params = { id: number }
  type Result = boolean
}

export const deleteCourse = /* @__PURE__ */ bindQueryValue<deleteCourse.Params, deleteCourse.Result>("delete_course", { id: t.int4 })

export declare namespace upsertFoo {
  type Params = [Foo.InsertParams]
  type Result = Foo
}

export const upsertFoo = /* @__PURE__ */ bindQueryRow<upsertFoo.Params, upsertFoo.Result>("upsert_foo", [t.foo], { address: t.address_type })

export declare namespace upsertCourseEnrollment {
  type Params = [CourseEnrollment.InsertParams]
  type Result = CourseEnrollment
}

export const upsertCourseEnrollment = /* @__PURE__ */ bindQueryRow<upsertCourseEnrollment.Params, upsertCourseEnrollment.Result>("upsert_course_enrollment", [t.course_enrollment])

export declare namespace updateAccount {
  type Params = { id: number, entries: string[] }
  type Result = Account
}

export const updateAccount = /* @__PURE__ */ bindQueryRow<updateAccount.Params, updateAccount.Result>("update_account", { id: t.int4, entries: t.text_array })

export declare namespace getCourseEnrollment {
  type Params = { studentId: number, courseId: number }
  type Result = CourseEnrollment
}

export const getCourseEnrollment = /* @__PURE__ */ bindQueryRow<getCourseEnrollment.Params, getCourseEnrollment.Result>("get_course_enrollment", { studentId: t.int4, courseId: t.int4 })

export declare namespace createCourseEnrollment {
  type Params = [CourseEnrollment.InsertParams]
  type Result = CourseEnrollment
}

export const createCourseEnrollment = /* @__PURE__ */ bindQueryRowList<createCourseEnrollment.Params, createCourseEnrollment.Result>("create_course_enrollment", [t.course_enrollment])

export declare namespace upsertCourse {
  type Params = [Course.InsertParams]
  type Result = Course
}

export const upsertCourse = /* @__PURE__ */ bindQueryRow<upsertCourse.Params, upsertCourse.Result>("upsert_course", [t.course])

export declare namespace deletePost {
  type Params = { id: number }
  type Result = boolean
}

export const deletePost = /* @__PURE__ */ bindQueryValue<deletePost.Params, deletePost.Result>("delete_post", { id: t.int4 })
