const snakeRegex = /_([a-z0-9])/g
const toUpperCase = (_: any, letter: string) => letter.toUpperCase()

/**
 * Convert a snake_case string to camelCase.
 */
export const snakeToCamel = (name: string) =>
  name.replace(snakeRegex, toUpperCase)
