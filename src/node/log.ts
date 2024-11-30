import {
  blue,
  bold,
  type Colorize,
  cyan,
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

const createLog = (
  color: Colorize,
  prefix = '•',
  method: 'log' | 'trace' = 'log',
) =>
  function log(message: string, ...args: any[]) {
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

type Logger = ReturnType<typeof createLog>

export const log = createLog(blue) as Logger & {
  error: Logger
  warn: Logger
  success: Logger
  command: Logger
  comment: Logger
  green: Logger
  cyan: Logger
  magenta: Logger
  task: (message: string) => () => void
  enableTimestamps: (enabled: boolean) => void
}

log.enableTimestamps = (enabled: boolean) => {
  logTimestampsEnabled = enabled
}

log.error = createLog(red, '⚠️', 'trace')
log.warn = createLog(yellow, '⚠️')
log.success = createLog(green, '✔️')
log.command = createLog(bold, '»')
log.comment = createLog(gray, ' ')
log.green = createLog(green)
log.cyan = createLog(cyan)
log.magenta = createLog(magenta)

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
  const start = Date.now()
  log(message)

  return () => {
    if (lastLoggedLine.includes(message)) {
      process.stdout.moveCursor(0, -1) // Move cursor up one line
      process.stdout.clearLine(0) // Clear entire line
      process.stdout.cursorTo(0) // Move cursor to start of line
    }
    const elapsed = (Date.now() - start) / 1000
    log.success(
      message + ' done' + (elapsed > 0.5 ? ` in ${elapsed.toFixed(1)}s` : ''),
    )
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
