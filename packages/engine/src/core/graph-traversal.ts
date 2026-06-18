import type { GraphJson } from "@zaa-tool/shared";

export function getReachableNodes(graph: GraphJson, startNodeId: string): Set<string> {
  const reachable = new Set<string>([startNodeId]);
  const queue = [startNodeId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const outgoing = graph.edges.filter((e) => e.source === current);
    for (const edge of outgoing) {
      if (!reachable.has(edge.target)) {
        reachable.add(edge.target);
        queue.push(edge.target);
      }
    }
  }
  return reachable;
}
