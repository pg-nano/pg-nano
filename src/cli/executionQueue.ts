export interface LinkedObject<TLinkedObject> {
  dependencies: Set<TLinkedObject>
}

/**
 * The execution queue orders objects such that dependencies are executed
 * before dependents.
 */
export class ExecutionQueue<TLinkedObject extends LinkedObject<any>>
  implements Iterable<TLinkedObject>
{
  private queue: Set<TLinkedObject>

  constructor(objects?: Iterable<TLinkedObject>) {
    this.queue = new Set(objects)
  }

  add(object: TLinkedObject) {
    this.queue.add(object)
  }

  [Symbol.iterator]() {
    const { queue } = this
    return (function* () {
      const visited = new Set<TLinkedObject>()
      function* visit(object: TLinkedObject) {
        for (const dep of object.dependencies) {
          visit(dep)
        }
        if (!visited.has(object)) {
          visited.add(object)
          yield object
        }
      }
      for (const object of queue) {
        yield* visit(object)
      }
    })()
  }
}
