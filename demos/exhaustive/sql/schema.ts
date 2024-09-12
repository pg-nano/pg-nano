import { bindQueryRow, bindQueryRowList, bindQueryValue, type JSON, type Point, type Range } from 'pg-nano'
import * as t from './types.js'

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
  enrollment_date: string
  grade?: string
}
export declare namespace CourseEnrollment {
  type InsertParams = {
    student_id: number
    course_id: number
    enrollment_date: string
    grade?: string
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
  color_preference?: string
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
    color_preference?: string
  }
}

export type Course = {
  id: number
  course_name: string
}
export declare namespace Course {
  type InsertParams = {
    course_name: string
  }
}

export declare namespace upsertCourse {
  type Params = { rec: Course.InsertParams }
  type Result = Course
}

export const upsertCourse = /* @__PURE__ */ bindQueryRow<upsertCourse.Params, upsertCourse.Result>("upsert_course", { rec: t.course })

export declare namespace replaceCourseEnrollment {
  type Params = { studentId: number, courseId: number, rec: CourseEnrollment.InsertParams }
  type Result = CourseEnrollment
}

export const replaceCourseEnrollment = /* @__PURE__ */ bindQueryRow<replaceCourseEnrollment.Params, replaceCourseEnrollment.Result>("replace_course_enrollment", { "studentId": t.int4, "courseId": t.int4, rec: t.course_enrollment })

export declare namespace replaceCourse {
  type Params = { id: number, rec: Course.InsertParams }
  type Result = Course
}

export const replaceCourse = /* @__PURE__ */ bindQueryRow<replaceCourse.Params, replaceCourse.Result>("replace_course", { id: t.int4, rec: t.course })

export declare namespace createPost {
  type Params = { title: string, content: string, authorId: number }
  type Result = void
}

export const createPost = /* @__PURE__ */ bindQueryValue<createPost.Params, createPost.Result>("create_post", { title: t.text, content: t.text, "authorId": t.int4 })

export declare namespace getCourse {
  type Params = { id: number }
  type Result = Course
}

export const getCourse = /* @__PURE__ */ bindQueryRow<getCourse.Params, getCourse.Result>("get_course", { id: t.int4 })

export declare namespace createAccount {
  type Params = { username: string, email: string, password: string, salt: string, firstName?: string, lastName?: string, dateOfBirth?: string }
  type Result = number
}

export const createAccount = /* @__PURE__ */ bindQueryValue<createAccount.Params, createAccount.Result>("create_account", { username: t.varchar, email: t.varchar, password: t.varchar, salt: t.varchar, "firstName": t.varchar, "lastName": t.varchar, "dateOfBirth": t.date })

export declare namespace createCourse {
  type Params = { rec: Course.InsertParams }
  type Result = Course
}

export const createCourse = /* @__PURE__ */ bindQueryRowList<createCourse.Params, createCourse.Result>("create_course", { rec: t.course })

export declare namespace calculateGpa {
  type Params = { studentId: number }
  type Result = { total_gpa: string }
}

export const calculateGpa = /* @__PURE__ */ bindQueryRow<calculateGpa.Params, calculateGpa.Result>("calculate_gpa", { "studentId": t.int4 })

export declare namespace deleteCourseEnrollment {
  type Params = { studentId: number, courseId: number }
  type Result = boolean
}

export const deleteCourseEnrollment = /* @__PURE__ */ bindQueryValue<deleteCourseEnrollment.Params, deleteCourseEnrollment.Result>("delete_course_enrollment", { "studentId": t.int4, "courseId": t.int4 })

export declare namespace deleteAccount {
  type Params = [number]
  type Result = boolean
}

export const deleteAccount = /* @__PURE__ */ bindQueryValue<deleteAccount.Params, deleteAccount.Result>("delete_account", [t.int4])

export declare namespace getFoo {
  type Params = { id: number }
  type Result = Foo
}

export const getFoo = /* @__PURE__ */ bindQueryRowList<getFoo.Params, getFoo.Result>("get_foo", { id: t.int4 }, { address: t.address_type })

export declare namespace updateCourseEnrollment {
  type Params = { studentId: number, courseId: number, data: JSON }
  type Result = CourseEnrollment
}

export const updateCourseEnrollment = /* @__PURE__ */ bindQueryRow<updateCourseEnrollment.Params, updateCourseEnrollment.Result>("update_course_enrollment", { "studentId": t.int4, "courseId": t.int4, data: t.json })

export declare namespace createCourseEnrollment {
  type Params = { rec: CourseEnrollment.InsertParams }
  type Result = CourseEnrollment
}

export const createCourseEnrollment = /* @__PURE__ */ bindQueryRowList<createCourseEnrollment.Params, createCourseEnrollment.Result>("create_course_enrollment", { rec: t.course_enrollment })

export declare namespace deleteCourse {
  type Params = { id: number }
  type Result = boolean
}

export const deleteCourse = /* @__PURE__ */ bindQueryValue<deleteCourse.Params, deleteCourse.Result>("delete_course", { id: t.int4 })

export declare namespace upsertCourseEnrollment {
  type Params = { rec: CourseEnrollment.InsertParams }
  type Result = CourseEnrollment
}

export const upsertCourseEnrollment = /* @__PURE__ */ bindQueryRow<upsertCourseEnrollment.Params, upsertCourseEnrollment.Result>("upsert_course_enrollment", { rec: t.course_enrollment })

export declare namespace getCourseEnrollment {
  type Params = { studentId: number, courseId: number }
  type Result = CourseEnrollment
}

export const getCourseEnrollment = /* @__PURE__ */ bindQueryRow<getCourseEnrollment.Params, getCourseEnrollment.Result>("get_course_enrollment", { "studentId": t.int4, "courseId": t.int4 })

export declare namespace updateCourse {
  type Params = { id: number, data: JSON }
  type Result = Course
}

export const updateCourse = /* @__PURE__ */ bindQueryRow<updateCourse.Params, updateCourse.Result>("update_course", { id: t.int4, data: t.json })
