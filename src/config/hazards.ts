export type MigrationHazardType = (typeof allMigrationHazardTypes)[number]

// https://github.com/stripe/pg-schema-diff/blob/main/pkg/diff/plan.go#L12
export const allMigrationHazardTypes = [
  'ACQUIRES_ACCESS_EXCLUSIVE_LOCK',
  'ACQUIRES_SHARE_LOCK',
  'ACQUIRES_SHARE_ROW_EXCLUSIVE_LOCK',
  'AUTHZ_UPDATE',
  'CORRECTNESS',
  'DELETES_DATA',
  'IMPACTS_DATABASE_PERFORMANCE',
  'INDEX_BUILD',
  'INDEX_DROPPED',
  'IS_USER_GENERATED',
  'UPGRADING_EXTENSION_VERSION',
] as const
