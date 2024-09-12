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

  get size() {
    return this.queue.size
  }

  add(object: TLinkedObject) {
    this.queue.add(object)
  }

  *[Symbol.iterator]() {
    const visited = new Set<TLinkedObject>()
    function* visit(object: TLinkedObject): Generator<TLinkedObject> {
      if (!visited.has(object)) {
        visited.add(object)
        for (const dep of object.dependencies) {
          yield* visit(dep)
        }
        yield object
      }
    }
    for (const object of this.queue) {
      yield* visit(object)
    }
  }
}
