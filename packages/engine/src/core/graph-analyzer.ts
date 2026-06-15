import type { GraphJson, EdgeDef } from "@zaa-tool/shared";

export class GraphAnalyzer {
  /**
   * Topological sorting using Kahn's algorithm.
   */
  static topoSort(graph: GraphJson): string[] {
    const inDegree = new Map<string, number>();
    const adjList = new Map<string, string[]>();

    // Initialize
    for (const node of graph.nodes) {
      inDegree.set(node.id, 0);
      adjList.set(node.id, []);
    }

    // Calculate in-degree
    for (const edge of graph.edges) {
      inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
      adjList.get(edge.source)!.push(edge.target);
    }

    // Queue of in-degree = 0 nodes
    const queue = [...inDegree.entries()]
      .filter(([, deg]) => deg === 0)
      .map(([id]) => id);

    const order: string[] = [];

    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      order.push(nodeId);

      for (const neighbor of adjList.get(nodeId) ?? []) {
        const newDeg = (inDegree.get(neighbor) ?? 0) - 1;
        inDegree.set(neighbor, newDeg);
        if (newDeg === 0) {
          queue.push(neighbor);
        }
      }
    }

    if (order.length !== graph.nodes.length) {
      throw new Error("Graph is not a DAG — there's a cycle!");
    }

    return order;
  }

  /**
   * Traverses downstream starting from the target of matching edges to identify all reachable nodes.
   */
  static getReachableNodes(graph: GraphJson, startEdges: EdgeDef[]): Set<string> {
    const visited = new Set<string>();
    const queue: string[] = startEdges.map((e) => e.target);

    for (const target of queue) {
      visited.add(target);
    }

    while (queue.length > 0) {
      const current = queue.shift()!;
      const nextEdges = graph.edges.filter((e) => e.source === current);
      for (const edge of nextEdges) {
        if (!visited.has(edge.target)) {
          visited.add(edge.target);
          queue.push(edge.target);
        }
      }
    }
    return visited;
  }

  /**
   * Identifies all loop body nodes. Loop body consists of nodes reachable from body handles,
   * but not reachable from exit handles.
   */
  static getLoopBodyNodes(graph: GraphJson, loopNodeId: string): Set<string> {
    const bodyStartEdges = graph.edges.filter(
      (e) => e.source === loopNodeId && (e.sourceHandle === "body" || e.sourceHandle === "item" || e.sourceHandle === "element")
    );
    const bodyNodes = this.getReachableNodes(graph, bodyStartEdges);

    const exitStartEdges = graph.edges.filter(
      (e) => e.source === loopNodeId && (e.sourceHandle === "output" || e.sourceHandle === "exit" || e.sourceHandle === "done" || e.sourceHandle === "completed")
    );
    const exitNodes = this.getReachableNodes(graph, exitStartEdges);

    const loopBodyNodeIds = new Set<string>();
    for (const id of bodyNodes) {
      if (!exitNodes.has(id) && id !== loopNodeId) {
        loopBodyNodeIds.add(id);
      }
    }

    return loopBodyNodeIds;
  }

  /**
   * Finds all loop body nodes for all loop nodes in the entire graph.
   */
  static getAllLoopBodyNodes(graph: GraphJson): Set<string> {
    const allLoopBodyNodes = new Set<string>();
    for (const node of graph.nodes) {
      if (node.type === "loop") {
        const loopBody = this.getLoopBodyNodes(graph, node.id);
        for (const id of loopBody) {
          allLoopBodyNodes.add(id);
        }
      }
    }
    return allLoopBodyNodes;
  }
}
