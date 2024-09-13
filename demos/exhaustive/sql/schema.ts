import { routineQueryAll, routineQueryOne, routineQueryOneValue, type JSON, type Point, type Range } from 'pg-nano'

export const CourseEnrollment = ["student_id", "course_id", "enrollment_date", "grade"]

export const Course = ["id", "course_name"]

export const AddressType = ["street", "city", "state", "zip_code"]

export const Foo = ["id", "name", "description", "created_at", "updated_at", "is_active", "score", "tags", "matrix", "metadata", "binary_data", "coordinates", "ip_address", "mac_address", "price_range", "schedule", "priority", "uuid", "search_vector", "status", { address: AddressType }, "product_attributes", "color_preference"]

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

export type Course = {
  id: number
  course_name: string
}
export declare namespace Course {
  type InsertParams = {
    course_name: string
  }
}

export type Foo = {
  id: number
  name: string
  description?: string
  created_at: Date
  updated_at: Date
  is_active: boolean
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

export declare namespace upsertCourseEnrollment {
  type Params = { rec: CourseEnrollment.InsertParams }
  type Result = CourseEnrollment
}

export const upsertCourseEnrollment = /* @__PURE__ */ routineQueryOne<upsertCourseEnrollment.Params, upsertCourseEnrollment.Result>("upsert_course_enrollment", [{ rec: CourseEnrollment }])

export declare namespace upsertCourse {
  type Params = { rec: Course.InsertParams }
  type Result = Course
}

export const upsertCourse = /* @__PURE__ */ routineQueryOne<upsertCourse.Params, upsertCourse.Result>("upsert_course", [{ rec: Course }])

export declare namespace getCourse {
  type Params = { id: number }
  type Result = Course
}

export const getCourse = /* @__PURE__ */ routineQueryOne<getCourse.Params, getCourse.Result>("get_course", ["id"])

export declare namespace createCourse {
  type Params = { rec: Course.InsertParams }
  type Result = Course
}

export const createCourse = /* @__PURE__ */ routineQueryAll<createCourse.Params, createCourse.Result>("create_course", [{ rec: Course }])

export declare namespace deleteCourseEnrollment {
  type Params = { studentId: number, courseId: number }
  type Result = boolean
}

export const deleteCourseEnrollment = /* @__PURE__ */ routineQueryOneValue<deleteCourseEnrollment.Params, deleteCourseEnrollment.Result>("delete_course_enrollment", ["studentId", "courseId"])

export declare namespace deleteAccount {
  type Params = [number]
  type Result = boolean
}

export const deleteAccount = /* @__PURE__ */ routineQueryOneValue<deleteAccount.Params, deleteAccount.Result>("delete_account")

export declare namespace createCourseEnrollment {
  type Params = { rec: CourseEnrollment.InsertParams }
  type Result = CourseEnrollment
}

export const createCourseEnrollment = /* @__PURE__ */ routineQueryAll<createCourseEnrollment.Params, createCourseEnrollment.Result>("create_course_enrollment", [{ rec: CourseEnrollment }])

export declare namespace deleteCourse {
  type Params = { id: number }
  type Result = boolean
}

export const deleteCourse = /* @__PURE__ */ routineQueryOneValue<deleteCourse.Params, deleteCourse.Result>("delete_course", ["id"])

export declare namespace createAccount {
  type Params = { username: string, email: string, password: string, salt: string, firstName?: string, lastName?: string, dateOfBirth?: string }
  type Result = number
}

export const createAccount = /* @__PURE__ */ routineQueryOneValue<createAccount.Params, createAccount.Result>("create_account", ["username", "email", "password", "salt", "firstName", "lastName", "dateOfBirth"])

export declare namespace replaceCourseEnrollment {
  type Params = { studentId: number, courseId: number, rec: CourseEnrollment.InsertParams }
  type Result = CourseEnrollment
}

export const replaceCourseEnrollment = /* @__PURE__ */ routineQueryOne<replaceCourseEnrollment.Params, replaceCourseEnrollment.Result>("replace_course_enrollment", ["studentId", "courseId", { rec: CourseEnrollment }])

export declare namespace calculateGpa {
  type Params = { studentId: number }
  type Result = { total_gpa: string }
}

export const calculateGpa = /* @__PURE__ */ routineQueryOne<calculateGpa.Params, calculateGpa.Result>("calculate_gpa", ["studentId", "totalGpa"])

export declare namespace getFoo {
  type Params = { id: number }
  type Result = Foo
}

export const getFoo = /* @__PURE__ */ routineQueryAll<getFoo.Params, getFoo.Result>("get_foo", ["id"])

export declare namespace getCourseEnrollment {
  type Params = { studentId: number, courseId: number }
  type Result = CourseEnrollment
}

export const getCourseEnrollment = /* @__PURE__ */ routineQueryOne<getCourseEnrollment.Params, getCourseEnrollment.Result>("get_course_enrollment", ["studentId", "courseId"])

export declare namespace dropAccountNamed {
  type Params = { username: string }
  type Result = unknown
}

export const dropAccountNamed = /* @__PURE__ */ routineQueryOneValue<dropAccountNamed.Params, dropAccountNamed.Result>("drop_account_named", ["username"])

export declare namespace updateCourseEnrollment {
  type Params = { studentId: number, courseId: number, data: JSON }
  type Result = CourseEnrollment
}

export const updateCourseEnrollment = /* @__PURE__ */ routineQueryOne<updateCourseEnrollment.Params, updateCourseEnrollment.Result>("update_course_enrollment", ["studentId", "courseId", "data"])

export declare namespace replaceCourse {
  type Params = { id: number, rec: Course.InsertParams }
  type Result = Course
}

export const replaceCourse = /* @__PURE__ */ routineQueryOne<replaceCourse.Params, replaceCourse.Result>("replace_course", ["id", { rec: Course }])

export declare namespace updateCourse {
  type Params = { id: number, data: JSON }
  type Result = Course
}

export const updateCourse = /* @__PURE__ */ routineQueryOne<updateCourse.Params, updateCourse.Result>("update_course", ["id", "data"])

export declare namespace createPost {
  type Params = { title: string, content: string, authorId: number }
  type Result = void
}

export const createPost = /* @__PURE__ */ routineQueryOneValue<createPost.Params, createPost.Result>("create_post", ["title", "content", "authorId"])
