/**
 * When a timestamp is not a Date instance, it's either Infinity or -Infinity.
 * @see https://www.postgresql.org/docs/current/datatype-datetime.html#DATATYPE-DATETIME-SPECIAL-VALUES
 */
export type Timestamp = Date | number

export type Point = { x: number; y: number }

export type Circle = Point & { radius: number }

export type JSON = string | number | boolean | JSONObject | JSONArray | null

type JSONObject = { [key: string]: JSON }
type JSONArray = JSON[]
