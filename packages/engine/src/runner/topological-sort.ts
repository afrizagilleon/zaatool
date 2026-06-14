import type { GraphJson } from "@zaa-tool/shared";

export function topoSort(graph: GraphJson): string[] {
  const inDegree = new Map<string, number>();
  const adjList = new Map<string, string[]>();

  // initialize all nodes with an inDegree of 0
  for (const node of graph.nodes) {
    inDegree.set(node.id, 0);
    adjList.set(node.id, []);
  }

  // calculate how many edges enter each node
  for (const edge of graph.edges) {
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
    adjList.get(edge.source)!.push(edge.target);
  }

  // Kahn's algorithm — node with inDegree=0 first
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
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  // if order.length < n node → there's a cycle (not a DAG)
  if (order.length !== graph.nodes.length) {
    throw new Error("Graph is not a DAG — there's a cycle!");
  }

  return order;
}
