import {
  blue,
  bold,
  type Colorize,
  cyan,
  gray,
  green,
  magenta,
  red,
  yellow,
} from 'kleur/colors'
import { URL } from 'node:url'
import { isString } from 'radashi'

let logTimestampsEnabled = false

const createLog =
  (color: Colorize, prefix = '•') =>
  (message: string, ...args: any[]) => {
    message = color(prefix + ' ' + message)
    if (logTimestampsEnabled) {
      const timestamp = new Date().toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
      })
      message = gray(`[${timestamp}]`) + ' ' + message
    }
    console.log(message, ...relativizePathArgs(args))
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
  eraseLine: () => void
  enableTimestamps: (enabled: boolean) => void
}

log.enableTimestamps = (enabled: boolean) => {
  logTimestampsEnabled = enabled
}

log.error = createLog(red, '⚠️')
log.warn = createLog(yellow, '⚠️')
log.success = createLog(green, '✔️')
log.command = createLog(bold, '»')
log.comment = createLog(gray, ' ')
log.green = createLog(green)
log.cyan = createLog(cyan)
log.magenta = createLog(magenta)

log.eraseLine = () => {
  process.stdout.write('\x1B[1A') // Move cursor up one line
  process.stdout.write(' '.repeat(process.stdout.columns)) // Write spaces to clear the line
  process.stdout.write('\r') // Move cursor to start of line
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
