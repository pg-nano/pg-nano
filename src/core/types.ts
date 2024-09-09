export type Point = { x: number; y: number }

export type Circle = Point & { radius: number }

export type JSON = string | number | boolean | JSONObject | JSONArray | null

type JSONObject = { [key: string]: JSON }
type JSONArray = JSON[]
