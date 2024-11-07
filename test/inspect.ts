import { ChildProcess } from 'node:child_process'
import { inspect, type InspectOptions } from 'node:util'

// @ts-ignore
ChildProcess.prototype[inspect.custom] = function (
  this: ChildProcess,
  _depth: number,
  options: InspectOptions,
) {
  return `ChildProcess ${inspect({ spawnfile: this.spawnfile, spawnargs: this.spawnargs }, options)}`
}
