export class PgNativeError extends Error {
  constructor(message: string) {
    super('[pg-native] ' + message)
    this.name = 'PgNativeError'
  }
}
