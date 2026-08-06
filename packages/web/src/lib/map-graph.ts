import dagre from 'dagre';
import { MarkerType, type Edge, type Node } from '@xyflow/react';
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

/** One thing a notebook calls, as it appears on that notebook's `calls:` chip. */
export interface CallTarget {
  label: string;
  /** Set when the call resolves, so the line can be clicked to travel there. */
  notebookId?: string;
  /**
   * Why it does not resolve, when it does not.
   *
   * Kept rather than dropped: "no such notebook" is the whole point of a map that reads
   * the code instead of trusting a drawing, and it stays visible — it just stopped being
   * a box of its own on the far side of a long arrow.
   */
  problem?: 'missing' | 'ambiguous' | 'computed';
}

/**
 * Everything one notebook calls, gathered into a chip that sits under it.
 *
 * These used to be edges: one line per call, notebook to notebook, across the whole map.
 * With nine notebooks calling four shared ones that is thirteen long curves crossing every
 * band — a spider's web, and the honest word for it is unreadable. Worse, it scales the
 * wrong way: the more a system reuses, the less its map can be read.
 *
 * A list attached to its caller says the same thing in one place. It reads in the
 * direction the eye is already going, it grows downwards instead of outwards, and the
 * names stay clickable, so travelling still works.
 */
export interface CallsNodeData extends Record<string, unknown> {
  targets: CallTarget[];
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
  cell: { width: 240, height: 76 },
  callOut: { width: 180, height: 46 },
};

/** The `calls:` chip grows with what it lists, so its height is computed, not fixed. */
export const CALLS_CHIP = { width: 168, headerHeight: 15, lineHeight: 13, padding: 6 };

export function callsChipSize(targets: number): { width: number; height: number } {
  return {
    width: CALLS_CHIP.width,
    height: CALLS_CHIP.headerHeight + targets * CALLS_CHIP.lineHeight + CALLS_CHIP.padding,
  };
}

export function sizeFor(node: Node): { width: number; height: number } {
  if (node.type === 'mapTrigger') return SIZES.trigger;
  if (node.type === 'mapCell') return SIZES.cell;
  if (node.type === 'mapCallOut') return SIZES.callOut;
  if (node.type === 'mapCalls') {
    return callsChipSize((node.data as CallsNodeData).targets.length);
  }
  return SIZES.notebook;
}

// ── system level ──────────────────────────────────────────────────────────────

/** The name a call should read as. Falls back to the reference the code actually wrote. */
function nameOf(map: NotebookMap, notebookId: string): string | undefined {
  return map.notebooks.find((notebook) => notebook.id === notebookId)?.name;
}

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
      // Moving, and only when the trigger is live. An arrowhead says which way; the flow
      // says this is a thing that happens on its own, which is the fact a schedule is.
      animated: trigger.enabled,
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
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

  /**
   * One chip per caller, not one edge per call.
   *
   * Gathered by source so a notebook that calls four things is four lines in one box
   * rather than four lines across the map. Duplicates collapse: a cell calling the same
   * notebook in a loop is still one dependency.
   */
  const byCaller = new Map<string, CallTarget[]>();
  for (const call of map.calls) {
    const targets = byCaller.get(call.fromNotebookId) ?? [];
    const label =
      (call.toNotebookId && nameOf(map, call.toNotebookId)) || call.reference || 'unnamed';
    const problem: CallTarget['problem'] = call.resolved
      ? undefined
      : call.dynamic
        ? 'computed'
        : call.ambiguous
          ? 'ambiguous'
          : 'missing';

    if (targets.some((target) => target.label === label && target.problem === problem)) continue;
    targets.push({ label, notebookId: call.toNotebookId ?? undefined, problem });
    byCaller.set(call.fromNotebookId, targets);
  }

  for (const [callerId, targets] of byCaller) {
    nodes.push({
      id: `calls-${callerId}`,
      type: 'mapCalls',
      position: { x: 0, y: 0 },
      // Not selectable and not clickable as a whole: the clickable things are the names
      // inside it, and a chip that swallowed the click would stop them working.
      selectable: false,
      data: { targets } satisfies CallsNodeData,
    });
  }

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
        // A notebook is a sequence, and the drawing should say so without being read.
        // Which cell follows which was previously only inferable from the numbers.
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
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
          markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
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
  // 90px of air between one cell and the next put a five-cell notebook past the bottom of
  // the screen for no reason: vertically the gap is pure scrolling, and the arrow does not
  // read any better for being long.
  graph.setGraph({ rankdir, nodesep: 36, ranksep: rankdir === 'TB' ? 44 : 90 });
  graph.setDefaultEdgeLabel(() => ({}));

  // A fresh object per node: dagre writes the computed position into whatever it is
  // handed, so sharing one would place every node of that kind on top of the others.
  for (const node of nodes) graph.setNode(node.id, { ...sizeFor(node) });
  for (const edge of edges) graph.setEdge(edge.source, edge.target);

  dagre.layout(graph);

  return nodes.map((node) => {
    const placed = graph.node(node.id);
    return {
      ...node,
      position: { x: placed.x - placed.width / 2, y: placed.y - placed.height / 2 },
      // Declared rather than measured, for the same reason as the system level: nothing
      // that reads a node's size can find one xyflow measured into a copy we replace.
      ...sizeFor(node),
    };
  });
}
