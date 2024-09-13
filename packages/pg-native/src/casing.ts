const snakeRegex = /_([a-z0-9])/g
const camelRegex = /([a-z])([A-Z]+)/g

const toUpperCase = (_: any, letter: string) => letter.toUpperCase()

/**
 * Convert a snake_case string to camelCase.
 */
export const snakeToCamel = (name: string) =>
  name.replace(snakeRegex, toUpperCase)

/**
 * Convert a camelCase string to snake_case.
 */
export const camelToSnake = (name: string) =>
  name.replace(camelRegex, '$1_$2').toLowerCase()
