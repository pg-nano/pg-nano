import type Libpq from '@pg-nano/libpq'

export type PgNativeErrorType = 'PgNativeError' | 'PgResultError'

export class PgNativeError extends Error {
  name: PgNativeErrorType = 'PgNativeError'
}

export class PgResultError extends PgNativeError {
  name = 'PgResultError' as const
}

export interface PgResultError extends Libpq.ResultError {}

export function isPgResultError(error: Error): error is PgResultError {
  return error.name === 'PgResultError'
}
