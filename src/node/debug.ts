import createDebug from 'debug'

export const debug = createDebug('pg-nano')
export const traceChecks = createDebug('pg-nano:checks')
export const traceDepends = createDebug('pg-nano:depends')
export const traceParser = createDebug('pg-nano:parser')
export const traceRender = createDebug('pg-nano:render')
