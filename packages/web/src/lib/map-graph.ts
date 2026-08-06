import dagre from 'dagre';
import type { Edge, Node } from '@xyflow/react';
import { layoutSystem, type SystemLayout } from './map-layout';
import type {
  NotebookJson,
  NotebookMap,
  NotebookMapCall,
  NotebookMapNotebook,
  NotebookMapTrigger,
  NotebookStep,
} from '@zaa-tool/shared';

/**
 * Turns the derived map into something xyflow can draw, at two altitudes.
 *
 * Pure, and deliberately unaware of run state: laying out is expensive and a run event
 * arrives many times a second, so live status is merged into node data afterwards
 * rather than recomputed here. Positions stay put while a run lights the map up.
 */

export interface NotebookNodeData extends Record<string, unknown> {
  notebook: NotebookMapNotebook;
  /** Set while a run of this notebook is in flight, or briefly after it ends. */
  status?: 'running' | 'done' | 'error';
  /** True when something else is focused and this is not part of it. */
  dimmed?: boolean;
}

export interface TriggerNodeData extends Record<string, unknown> {
  trigger: NotebookMapTrigger;
  dimmed?: boolean;
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
  dimmed?: boolean;
}

export interface CellNodeData extends Record<string, unknown> {
  /** Position in the notebook, counting every cell including those inside lanes. */
  index: number;
  label: string;
  hasCode: boolean;
  laneLabel?: string;
  status?: 'running' | 'done' | 'error';
  /** How long it took in the run being replayed; absent when showing live. */
  ms?: number;
}

export interface CallOutNodeData extends Record<string, unknown> {
  label: string;
  /** Set when the call resolves, so clicking it can travel there. */
  notebookId?: string;
}

/**
 * Sizes here and in the components have to agree, or dagre lays out boxes of one size and
 * the screen draws another. The system-level boxes shrank in FX6: at 260×116, twenty-nine
 * notebooks could not be read at any zoom that fitted them, so a box now carries a name
 * and four marks and everything else waits for the pointer.
 */
export const SIZES = {
  notebook: { width: 190, height: 46 },
  trigger: { width: 170, height: 44 },
  unresolved: { width: 170, height: 44 },
  cell: { width: 240, height: 76 },
  callOut: { width: 180, height: 46 },
};

function sizeFor(type: string | undefined): { width: number; height: number } {
  if (type === 'mapTrigger') return SIZES.trigger;
  if (type === 'mapUnresolved') return SIZES.unresolved;
  if (type === 'mapCell') return SIZES.cell;
  if (type === 'mapCallOut') return SIZES.callOut;
  return SIZES.notebook;
}

// ── system level ──────────────────────────────────────────────────────────────

/**
 * What is on the system map. Where it goes is `map-layout.ts`.
 *
 * Split because they are different questions and only one of them was wrong: the graph
 * was right all along and the placement put thirty-three notebooks in a 4531px ribbon.
 */
export function buildMapGraph(
  map: NotebookMap,
  options: { showStandalone?: boolean } = {}
): SystemLayout {
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

  return layoutSystem(map, nodes, edges, options);
}

// ── notebook level ────────────────────────────────────────────────────────────

/**
 * What to call a cell on the map.
 *
 * The note's first line if there is one, because that is the author's own name for the
 * step. Failing that the first line of code that is not a comment — "code" told you
 * nothing, and a notebook of six cells all labelled "code" is not a map of anything.
 */
export function cellLabel(step: { note?: string; code?: string }): string {
  const heading = step.note
    ?.split('\n')
    .map((line) => line.replace(/^#+\s*/, '').trim())
    .find((line) => line.length > 0);
  if (heading) return heading.length > 44 ? `${heading.slice(0, 43)}…` : heading;

  const statement = step.code
    ?.split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith('//') && !line.startsWith('#'));
  if (statement) return statement.length > 44 ? `${statement.slice(0, 43)}…` : statement;

  return step.code !== undefined ? 'empty cell' : 'note';
}

/**
 * One notebook drawn as it runs: a chain, with a parallel group forking into its lanes
 * and joining again afterwards.
 *
 * The fork and the join are the reason this is a graph rather than a list. Everything
 * else about a notebook is linear, and the drawing says so.
 */
export function buildNotebookGraph(
  document: NotebookJson,
  calls: NotebookMapCall[],
  nameOf: (notebookId: string) => string | undefined
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  let index = 0;

  const connect = (from: string[], to: string, laneLabel?: string) => {
    for (const source of from) {
      edges.push({
        id: `flow-${source}-${to}`,
        source,
        target: to,
        label: laneLabel,
        className: 'map-edge-call',
      });
    }
  };

  /**
   * Returns the ids that anything after these steps must follow.
   *
   * `laneLabel` names the branch on the edge that enters it — which is where the eye
   * already is when it has to choose between two arrows.
   */
  const walk = (steps: NotebookStep[], incoming: string[], laneLabel?: string): string[] => {
    let previous = incoming;
    let pendingLabel = laneLabel;

    for (const step of steps) {
      if (step.kind === 'parallel') {
        const laneEnds: string[] = [];
        for (const lane of step.lanes ?? []) {
          laneEnds.push(...walk(lane.steps ?? [], previous, lane.label));
        }
        previous = laneEnds.length > 0 ? laneEnds : previous;
        pendingLabel = undefined;
        continue;
      }

      index += 1;
      const id = `cell-${step.id}`;
      nodes.push({
        id,
        type: 'mapCell',
        position: { x: 0, y: 0 },
        data: {
          index,
          label: cellLabel(step),
          hasCode: Boolean(step.code?.trim()),
          laneLabel,
        } satisfies CellNodeData,
      });
      connect(previous, id, pendingLabel);
      pendingLabel = undefined;
      previous = [id];

      for (const call of calls.filter((candidate) => candidate.fromCellId === step.id)) {
        const outId = `callout-${step.id}-${edges.length}`;
        nodes.push({
          id: outId,
          type: 'mapCallOut',
          position: { x: 0, y: 0 },
          data: {
            label: (call.toNotebookId && nameOf(call.toNotebookId)) || call.reference,
            notebookId: call.toNotebookId ?? undefined,
          } satisfies CallOutNodeData,
        });
        edges.push({
          id: `callout-edge-${outId}`,
          source: id,
          target: outId,
          label: 'calls',
          className: call.resolved ? 'map-edge-call' : 'map-edge-unresolved',
        });
      }
    }

    return previous;
  };

  walk(document.steps ?? [], []);
  return { nodes: layout(nodes, edges, 'TB'), edges };
}

// ── layout ────────────────────────────────────────────────────────────────────

function layout(nodes: Node[], edges: Edge[], rankdir: 'LR' | 'TB'): Node[] {
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir, nodesep: 36, ranksep: 90 });
  graph.setDefaultEdgeLabel(() => ({}));

  // A fresh object per node: dagre writes the computed position into whatever it is
  // handed, so sharing one would place every node of that kind on top of the others.
  for (const node of nodes) graph.setNode(node.id, { ...sizeFor(node.type) });
  for (const edge of edges) graph.setEdge(edge.source, edge.target);

  dagre.layout(graph);

  return nodes.map((node) => {
    const placed = graph.node(node.id);
    return {
      ...node,
      position: { x: placed.x - placed.width / 2, y: placed.y - placed.height / 2 },
      // Declared rather than measured, for the same reason as the system level: nothing
      // that reads a node's size can find one xyflow measured into a copy we replace.
      ...sizeFor(node.type),
    };
  });
}
