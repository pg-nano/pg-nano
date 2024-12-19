import {
  blue,
  type Colorize,
  gray,
  green,
  italic,
  magenta,
  red,
  yellow,
} from 'kleur/colors'
import { URL } from 'node:url'
import { isString } from 'radashi'

let logTimestampsEnabled = false

function createLogFunction(
  color: Colorize,
  enabled: boolean,
  prefix = '•',
  method: 'log' | 'trace' = 'log',
) {
  function log(message: string, ...args: any[]) {
    if (!log.enabled) {
      return
    }
    message = color(prefix + ' ' + message)
    if (logTimestampsEnabled) {
      const timestamp = new Date().toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
      message = gray(`[${timestamp}]`) + ' ' + message
    }
    console.log(message, ...relativizePathArgs(args))
    if (method === 'trace') {
      const trace = new Error()
      Error.captureStackTrace(trace, log)
      console.log(`    ――― ${italic('Log statement trace')} ―――`)
      console.log(color(trace.stack!.replace(/^.*?\n/, '')))
    }
  }
  log.enabled = enabled
  return log
}

type LogFunction = ReturnType<typeof createLogFunction>

export enum LogLevel {
  none = 0,
  error = 1,
  warn = 2,
  info = 3,
  verbose = 4,
}

export const log = createLogFunction(blue, true) as LogFunction & {
  error: LogFunction
  warn: LogFunction
  success: LogFunction
  verbose: LogFunction
  task: (message: string) => () => void
  enableTimestamps: (enabled: boolean) => void
  get logLevel(): LogLevel
  setLogLevel(logLevel: LogLevel): void
}

log.enableTimestamps = (enabled: boolean) => {
  logTimestampsEnabled = enabled
}

log.setLogLevel = (logLevel: LogLevel) => {
  if (logLevel !== log.logLevel) {
    Object.defineProperty(log, 'logLevel', {
      value: logLevel,
      configurable: true,
    })

    log.enabled = logLevel >= LogLevel.info
    log.error = createLogFunction(red, logLevel >= LogLevel.error, '⚠️', 'trace')
    log.warn = createLogFunction(yellow, logLevel >= LogLevel.warn, '⚠️')
    log.success = createLogFunction(green, logLevel >= LogLevel.info, '✔️')
    log.verbose = createLogFunction(magenta, logLevel >= LogLevel.verbose)
  }
}

log.setLogLevel(LogLevel.info)

let lastLoggedLine = ''

const updateLastLoggedLine = (arg: unknown) => {
  if (isString(arg)) {
    const message = arg.trimEnd()
    lastLoggedLine = message.slice(message.lastIndexOf('\n') + 1)
  }
}

const stdoutWrite: any = process.stdout.write.bind(process.stdout)
process.stdout.write = (...args) => {
  updateLastLoggedLine(args[0])
  return stdoutWrite(...args)
}

const stderrWrite: any = process.stderr.write.bind(process.stderr)
process.stderr.write = (...args) => {
  updateLastLoggedLine(args[0])
  return stderrWrite(...args)
}

log.task = (message: string) => {
  let start: number | null = Date.now()
  log(message)

  return () => {
    if (start !== null) {
      if (lastLoggedLine.includes(message)) {
        process.stdout.moveCursor(0, -1) // Move cursor up one line
        process.stdout.clearLine(0) // Clear entire line
        process.stdout.cursorTo(0) // Move cursor to start of line
      }

      const elapsed = (Date.now() - start) / 1000
      start = null

      log.success(
        message + ' done' + (elapsed > 0.5 ? ` in ${elapsed.toFixed(1)}s` : ''),
      )
    }
  }
}

function relativizePathArgs(args: any[]) {
  return args.map(arg => {
    if (
      isString(arg) &&
      URL.canParse('file://' + arg) &&
      arg.startsWith(process.cwd())
    ) {
      return '.' + arg.slice(process.cwd().length)
    }
    return arg
  })
}
