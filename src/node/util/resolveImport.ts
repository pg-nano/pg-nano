export function resolveImport(specifier: string) {
  // Once Vite supports import.meta.resolve, we can remove the require.resolve
  // fallback. See: https://github.com/vitejs/vite/discussions/15871
  let resolvedPath: string
  if (typeof import.meta.resolve === 'function') {
    resolvedPath = new URL(import.meta.resolve(specifier)).pathname
  } else {
    resolvedPath = require.resolve(specifier)
  }

  return resolvedPath
}
