export class PgNativeError extends Error {
  query?: string
  constructor(message?: string) {
    super(message)
    this.name = 'PgNativeError'
  }
}
