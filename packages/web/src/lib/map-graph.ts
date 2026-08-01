import dagre from 'dagre';
import type { Edge, Node } from '@xyflow/react';
import type { NotebookMap, NotebookMapNotebook, NotebookMapTrigger } from '@zaa-tool/shared';

/**
 * Turns the derived map into something xyflow can draw.
 *
 * Pure, and deliberately unaware of run state: laying out is expensive and a run event
 * arrives many times a second, so live status is merged into node data afterwards
 * rather than recomputed here. Positions stay put while a run lights the map up.
 */

export interface NotebookNodeData extends Record<string, unknown> {
  notebook: NotebookMapNotebook;
  /** Set while a run of this notebook is in flight, or briefly after it ends. */
  status?: 'running' | 'done' | 'error';
}

export interface TriggerNodeData extends Record<string, unknown> {
  trigger: NotebookMapTrigger;
}

/**
 * A call whose target could not be resolved.
 *
 * Drawn rather than dropped: an arrow into a box marked "no such notebook" is the
 * whole point of a map that reads the code instead of trusting a drawing.
 */
export interface UnresolvedNodeData extends Record<string, unknown> {
  label: string;
  reason: 'missing' | 'ambiguous' | 'computed';
}

const SIZES = {
  notebook: { width: 260, height: 116 },
  trigger: { width: 210, height: 58 },
  unresolved: { width: 190, height: 52 },
};

export function buildMapGraph(map: NotebookMap): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  for (const trigger of map.triggers) {
    nodes.push({
      id: `trigger-${trigger.id}`,
      type: 'mapTrigger',
      position: { x: 0, y: 0 },
      data: { trigger } satisfies TriggerNodeData,
    });
    edges.push({
      id: `fires-${trigger.id}`,
      source: `trigger-${trigger.id}`,
      target: `notebook-${trigger.notebookId}`,
      animated: false,
      className: trigger.enabled ? 'map-edge-trigger' : 'map-edge-disabled',
    });
  }

  for (const notebook of map.notebooks) {
    nodes.push({
      id: `notebook-${notebook.id}`,
      type: 'mapNotebook',
      position: { x: 0, y: 0 },
      data: { notebook } satisfies NotebookNodeData,
    });
  }

  map.calls.forEach((call, index) => {
    const source = `notebook-${call.fromNotebookId}`;

    if (call.resolved && call.toNotebookId) {
      edges.push({
        id: `call-${index}`,
        source,
        target: `notebook-${call.toNotebookId}`,
        label: 'calls',
        className: 'map-edge-call',
      });
      return;
    }

    const reason: UnresolvedNodeData['reason'] = call.dynamic
      ? 'computed'
      : call.ambiguous
        ? 'ambiguous'
        : 'missing';
    const id = `unresolved-${index}`;

    nodes.push({
      id,
      type: 'mapUnresolved',
      position: { x: 0, y: 0 },
      data: { label: call.reference, reason } satisfies UnresolvedNodeData,
    });
    edges.push({
      id: `call-${index}`,
      source,
      target: id,
      label: 'calls',
      className: 'map-edge-unresolved',
    });
  });

  return { nodes: layout(nodes, edges), edges };
}

function layout(nodes: Node[], edges: Edge[]): Node[] {
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: 'LR', nodesep: 28, ranksep: 110 });
  graph.setDefaultEdgeLabel(() => ({}));

  for (const node of nodes) {
    const size =
      node.type === 'mapTrigger'
        ? SIZES.trigger
        : node.type === 'mapUnresolved'
          ? SIZES.unresolved
          : SIZES.notebook;
    graph.setNode(node.id, size);
  }
  for (const edge of edges) graph.setEdge(edge.source, edge.target);

  dagre.layout(graph);

  return nodes.map((node) => {
    const placed = graph.node(node.id);
    return {
      ...node,
      position: { x: placed.x - placed.width / 2, y: placed.y - placed.height / 2 },
    };
  });
}
