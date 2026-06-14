import { useCallback } from 'react';
import dagre from 'dagre';
import { useFlowStore } from '../store/flowStore';

export function useAutoLayout() {
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);
  const onNodesChange = useFlowStore((s) => s.onNodesChange);

  const performLayout = useCallback((direction: 'TB' | 'LR' = 'TB') => {
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: direction, nodesep: 50, ranksep: 100 });
    g.setDefaultEdgeLabel(() => ({}));

    // Add nodes to dagre graph
    nodes.forEach((node) => {
      // Estimate width and height based on node type
      let width = 240; // Default width
      let height = 100; // Default height

      if (node.type === 'if') height = 120;
      if (node.type === 'loop') height = 120;
      if (node.type === 'code') height = 200;

      g.setNode(node.id, { width, height });
    });

    // Add edges to dagre graph
    edges.forEach((edge) => {
      g.setEdge(edge.source, edge.target);
    });

    // Calculate layout
    dagre.layout(g);

    // Apply new positions
    const newNodes = nodes.map((node) => {
      const nodeWithPosition = g.node(node.id);
      return {
        ...node,
        position: {
          x: nodeWithPosition.x - nodeWithPosition.width / 2,
          y: nodeWithPosition.y - nodeWithPosition.height / 2,
        },
      };
    });

    // Replace all nodes to update positions
    onNodesChange(
      newNodes.map((n) => ({
        type: 'position',
        id: n.id,
        position: n.position,
        positionAbsolute: n.position,
      }))
    );
  }, [nodes, edges, onNodesChange]);

  return performLayout;
}
