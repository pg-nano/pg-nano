export type JSON = string | number | boolean | JSONObject | JSONArray | null

type JSONObject = { [key: string]: JSON }
type JSONArray = JSON[]
