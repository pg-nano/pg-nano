export function toQualifiedId(name: string, schema: string | undefined) {
  return schema && schema !== 'public' && schema !== 'pg_catalog'
    ? `${schema}.${name}`
    : name
}
