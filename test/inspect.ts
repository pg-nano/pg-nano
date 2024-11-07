import { ChildProcess } from 'node:child_process'
import { inspect, type InspectOptions } from 'node:util'
import { SQLIdentifier } from 'pg-nano/plugin'
import { objectify } from 'radashi'

function inspectCustom<T>(
  ctor: new (...args: any[]) => T,
  stringify: (instance: T) => any,
) {
  ctor.prototype[inspect.custom] = function (
    this: T,
    _depth: number,
    options: InspectOptions,
  ) {
    return `${ctor.name} ${inspect(stringify(this), options)}`
  }
}

function inspectProperties(ctor: any, properties: string[]) {
  inspectCustom(ctor, (self: any) =>
    objectify(
      properties.filter(p => self[p] !== undefined),
      p => p,
      p => self[p],
    ),
  )
}

inspectProperties(ChildProcess, ['spawnfile', 'spawnargs'])
inspectCustom(SQLIdentifier, id => id.toQualifiedName())
