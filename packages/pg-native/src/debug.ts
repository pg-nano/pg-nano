import createDebug from 'debug'

export const debug = /* @__PURE__ */ createDebug('pg-native')

const createSubDebug = (name: string) => {
  return debug.enabled ? debug : createDebug('pg-native:' + name)
}

export const debugQuery = /* @__PURE__ */ createSubDebug('query')
export const debugConnection = /* @__PURE__ */ createSubDebug('connection')
