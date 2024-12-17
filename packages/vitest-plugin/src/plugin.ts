import * as devalue from 'devalue'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type { PgResultError } from 'pg-nano'
import type { Options as DevOptions } from 'pg-nano/dev'
import type { LogLevel, Project } from 'pg-nano/node'
import { shake, uid } from 'radashi'
import type { Plugin, ResolvedConfig } from 'vite'
import type { UserWorkspaceConfig } from 'vitest/node'
import errors from './errors'
import { type MessageHandlers, parseMessage } from './message'

export type Options = DevOptions & {
  connectionString?: string | undefined
  logLevel?: keyof typeof LogLevel
}

export default async (options: Options): Promise<Plugin> => {
  // Import here to avoid bundling into the config file.
  const {
    isPgResultError,
    dev,
    log,
    LogLevel,
    enableEventLogging,
    SQLIdentifier,
    WebSocketServer,
  } = await import('./pg-nano')

  if (options.logLevel !== 'none') {
    enableEventLogging(options.logLevel && LogLevel[options.logLevel])
  }

  if (options.connectionString) {
    options = { ...options }
    options.config = { ...options.config }
    options.config.dev = { ...options.config.dev }
    options.config.dev.connectionString = options.connectionString
  }

  const ipcPath = path.join(os.tmpdir(), 'pg-nano-ipc.' + uid(7))

  let config: ResolvedConfig

  const injectConfig = (
    _config: UserWorkspaceConfig,
  ): Partial<UserWorkspaceConfig> => ({
    test: {
      runner: import.meta.resolve('./runner'),
      environmentOptions: {
        wsPath: `ws+unix://${ipcPath}`,
      },
    },
  })

  return {
    name: '@pg-nano/vitest-plugin',
    config: config => injectConfig(config) as import('vite').UserConfig,
    async configResolved(res) {
      config = res
    },
    async configureServer(server) {
      const root = path.resolve(config.root, options.root ?? '')
      const generator = dev({
        ...options,
        root,
      })

      const triggerFile = path.join(root, '.test-sentinel')
      server.watcher.add(triggerFile)

      generator.events.on('finish', ([error, project]) => {
        if (error) {
          const onError = (error: any) =>
            log.error(error.stack ?? error.message)

          if (isPgResultError(error)) {
            rewritePostgresError(error, project).then(onError, onError)
          } else {
            onError(error)
          }
        } else {
          server.watcher.emit('change', triggerFile)
        }
      })

      const [error, project] = await generator
      if (error) {
        throw error
      }

      await startIPCServer({
        async 'pg-error'({ error }) {
          const patch = await rewritePostgresError(error as any, project)
          return { patch }
        },
      })
    },
  }

  async function startIPCServer(handlers: MessageHandlers) {
    const httpServer = http.createServer()
    const wsServer = new WebSocketServer({ server: httpServer })

    wsServer.on('connection', socket => {
      socket.on('message', payload => {
        const message = parseMessage(devalue.parse(payload.toString()))
        const promise = (async () => {
          const handler: any = handlers[message.type]
          if (!handler) {
            throw new Error(`No handler for message type: ${message.type}`)
          }
          return handler(message)
        })()

        if ('_id' in message) {
          const id = message._id
          promise.then(
            result => {
              socket.send(devalue.stringify({ _id: id, result }))
            },
            error => {
              socket.send(
                devalue.stringify({
                  _id: id,
                  error: { ...error, stack: error.stack },
                }),
              )
            },
          )
        } else {
          promise.catch(console.error)
        }
      })
    })

    await new Promise<void>(resolve => {
      httpServer.listen(ipcPath, resolve)
    })
  }

  async function rewritePostgresError(
    error: PgResultError,
    project: Project,
  ): Promise<Partial<PgResultError> | undefined> {
    let message = error.message
    let stack = error.stack!

    // When a pg-nano client has its "debug" option enabled, a more useful stack
    // trace is appended to the error. In that case, remove any stack frames
    // before the debug header.
    const debugHeaderIndex = stack.indexOf('Query constructor trace')
    if (debugHeaderIndex !== -1) {
      const frameIndex = stack.indexOf('\n    at ')
      if (frameIndex !== -1) {
        stack =
          stack.slice(0, frameIndex) +
          stack.slice(stack.indexOf('\n', debugHeaderIndex))
      }
    }

    const contextLines = error.context?.split('\n')
    if (contextLines) {
      const callStack: string[] = []
      const newStackFrames: string[] = []

      for (const context of contextLines) {
        let funcName: string | undefined
        let errorLine: number | undefined
        let errorColumn: number | undefined

        // Compilation errors have a different context format. We can assume
        // that a compilation error is always first in the call stack.
        if (callStack.length === 0) {
          const contextRegex = /^compilation of PL\/pgSQL function "(.+?)"/
          const contextMatch = context.match(contextRegex)

          funcName = contextMatch?.[1]
        }

        if (!funcName) {
          const contextRegex = /^PL\/pgSQL function ([\w."]+).+? line (\d+) /
          const contextMatch = context.match(contextRegex)

          if (contextMatch) {
            funcName = contextMatch[1]
            errorLine = Number(contextMatch[2]) - 1
          } else {
            continue
          }
        }

        const funcId = SQLIdentifier.parse(funcName)
        const func = await project.findObjectStatement(
          funcId.schema ?? 'public',
          funcId.name,
        )

        if (!func || func.kind !== 'routine') {
          continue
        }

        const sourceBoundary = /\sAS\s([^\s]+)/i.exec(func.query)
        if (!sourceBoundary) {
          continue
        }

        const sourceStart = sourceBoundary[0].length + sourceBoundary.index

        // The internalPosition only applies to the top stack frame.
        if (
          newStackFrames.length === 0 &&
          error.internalPosition != null &&
          error.internalQuery != null
        ) {
          // The internalQuery may be a substring of the function body.
          const queryPosition =
            func.query.indexOf(error.internalQuery) - sourceStart

          if (queryPosition >= 0) {
            const internalPosition = Number(error.internalPosition) - 1
            const errorPosition = sourceStart + queryPosition + internalPosition

            // Calculate a zero-indexed line number by counting the number of
            // line breaks between the start of the function body and the error
            // position.
            errorLine ??= countLineBreaks(
              func.query,
              sourceStart,
              errorPosition,
            )

            // Calculate a zero-indexed column number using the index of the
            // last line break before the error position.
            errorColumn =
              errorPosition - (1 + func.query.lastIndexOf('\n', errorPosition))
          }
        }

        const sourceEnd = func.query.indexOf(sourceBoundary[1], sourceStart)
        const sourceLines = func.query.slice(sourceStart, sourceEnd).split('\n')

        if (newStackFrames.length === 0 && errorLine != null) {
          const codeFrame = renderCodeFrame({
            sourceLines,
            baseLine: func.line,
            startLine: errorLine - 4,
            endLine: errorLine + 4,
            errorLine,
            errorColumn,
          })

          message += `\n${codeFrame}`
        }

        if (errorColumn == null) {
          const calledFunc = callStack.at(-1)

          // Find the callsite of the inner function.
          if (calledFunc && errorLine != null) {
            // Convert the "error line" to a zero-indexed position in the
            // `CREATE FUNCTION` statement.
            let errorLinePosition = sourceLines
              .slice(0, errorLine)
              .reduce((acc, line) => acc + line.length + 1, sourceStart)

            // Find the position of the callsite in the `CREATE FUNCTION`
            // statement.
            const callRegex = new RegExp(`\\b${calledFunc}\\b`, 'g')
            callRegex.lastIndex = errorLinePosition
            const callPosition = callRegex.exec(func.query)?.index

            if (callPosition != null) {
              // Account for the possibility that the callsite is found on a
              // line *after* the alleged "error line". This can happen with
              // multi-line SELECT statements, for example.
              const linesAfterErrorLine = countLineBreaks(
                func.query,
                errorLinePosition,
                callPosition,
              )
              if (linesAfterErrorLine > 0) {
                for (let i = 0; i < linesAfterErrorLine; i++) {
                  errorLinePosition += sourceLines[errorLine + i].length + 1
                }
                errorLine += linesAfterErrorLine
              }

              // Convert the call position to a zero-indexed column number.
              errorColumn = callPosition - errorLinePosition
            }
          }

          // If the error column is not found, use the first non-whitespace
          // character in the error line.
          errorColumn ??=
            errorLine != null
              ? sourceLines[errorLine].match(/\S/)?.index ?? 0
              : 0
        }

        const linkedLine =
          func.line +
          (errorLine != null
            ? countLineBreaks(func.query, 0, sourceStart) + errorLine
            : 0)

        const linkedColumn = errorColumn + 1

        callStack.push(funcName)
        newStackFrames.push(
          `\n    at ${funcName} (file://${func.file}:${linkedLine}:${linkedColumn})`,
        )
      }

      // Prepend stack frames for PL/pgSQL function errors.
      if (newStackFrames.length > 0) {
        stack = stack.replace(/^ {4}at /m, newStackFrames.join('') + '\n$&')
      }

      let code = error.sqlState
      if (code in errors) {
        code += `][${errors[code]}`
      }

      // Remove the "CONTEXT:" part of the error message.
      message = message.replace(
        error.message,
        `${error.severity}: ${error.messagePrimary} [${code}]` +
          (error.messageDetail ? `\nDETAIL: ${error.messageDetail}` : '') +
          (error.messageHint ? `\nHINT: ${error.messageHint}` : '') +
          '\n',
      )
    }

    return shake({
      message: message !== error.message ? message : undefined,
      stack: stack !== error.stack ? stack : undefined,
    })
  }
}

function countLineBreaks(str: string, startOffset: number, endOffset: number) {
  let count = 0
  for (let i = startOffset; i < endOffset; i++) {
    if (str[i] === '\n') {
      count++
    }
  }
  return count
}

function renderCodeFrame({
  sourceLines,
  baseLine,
  startLine,
  endLine,
  errorLine,
  errorColumn,
}: {
  /**
   * The lines of the source code.
   */
  sourceLines: string[]
  /**
   * When printing line numbers, this number is added to each line number. This
   * is useful when `sourceLines` doesn't represent an entire file.
   */
  baseLine: number
  /**
   * The first line number (zero-indexed) to print.
   */
  startLine: number
  /**
   * The last line number (zero-indexed) to print.
   */
  endLine: number
  /**
   * The line number (zero-indexed) of the error in the source.
   */
  errorLine: number
  /**
   * The column number (zero-indexed) of the error in the source line.
   */
  errorColumn: number | null | undefined
}) {
  startLine = Math.max(0, startLine)
  endLine = Math.min(sourceLines.length - 1, endLine)

  // The width of the line number column.
  const gutterWidth = String(baseLine + endLine).length

  let output = ''

  for (let line = startLine; line <= endLine; line++) {
    output += `${line === errorLine ? '> ' : '  '}${String(baseLine + line).padStart(gutterWidth)} | ${sourceLines[line]}\n`

    if (line === errorLine && errorColumn != null) {
      output += ' '.repeat(3 + gutterWidth) + `| ${' '.repeat(errorColumn)}^\n`
    }
  }

  return output
}
