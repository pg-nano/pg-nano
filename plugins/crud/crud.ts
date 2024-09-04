import type { Plugin } from '@pg-nano/plugin'

export default function (): Plugin {
  return {
    name: '@pg-nano/plugin-crud',
    async queries({ sql }) {
      return sql`
        
      `
    },
  }
}
