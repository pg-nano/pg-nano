export interface TopologicalNode {
  dependencies: Set<this>
}

/**
 * A topological set maintains a collection of nodes and provides iteration in
 * topological order, ensuring dependencies are visited before dependents.
 */
export class TopologicalSet<T extends TopologicalNode> implements Iterable<T> {
  private nodes: Set<T>

  constructor(nodes?: Iterable<T>) {
    this.nodes = new Set(nodes)
  }

  get size() {
    return this.nodes.size
  }

  add(object: T) {
    this.nodes.add(object)
  }

  *[Symbol.iterator]() {
    const visited = new Set<T>()
    function* visit(node: T): Generator<T> {
      if (!visited.has(node)) {
        visited.add(node)
        for (const dep of node.dependencies) {
          yield* visit(dep)
        }
        yield node
      }
    }
    for (const node of this.nodes) {
      yield* visit(node)
    }
  }
}
