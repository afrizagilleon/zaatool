import dagre from 'dagre';
import type { Edge, Node } from '@xyflow/react';
import {
  MAP_ROLE_ORDER,
  connectedNotebooks,
  mapRoles,
  type MapRole,
  type NotebookMap,
} from '@zaa-tool/shared';
import { SIZES, sizeFor } from './map-graph';

/**
 * Where the boxes go, and nothing else.
 *
 * Split out of `map-graph.ts` because the two answer different questions — what is on the
 * map, and where it sits — and because this one is the part that was wrong. Measured
 * before it was touched: thirty-three notebooks laid out **4531px tall** in five columns.
 * A ribbon you scroll for half a minute, which is not a map of anything.
 *
 * The cause is not dagre being bad at this. It is that twenty-nine of those notebooks have
 * no edges at all, and a layered graph engine has nothing to say about a node with no
 * relations: they all land in rank 0 and stack downwards forever. Laying out unrelated
 * things with a tool for related things is the mistake.
 *
 * So there are two layouts here, chosen by whether a notebook is joined to anything:
 *
 *  - **Joined** — dagre, in three stacked bands by how the notebook is reached, because
 *    "what starts on its own" is the question you open a map to answer.
 *  - **Alone** — a grid, which is the right shape for a set with no relations, and hidden
 *    by default because twenty-nine of them bury the four that matter.
 *
 * Pure, and measured rather than admired: `map-layout.test.tsx` asserts the height, the
 * band order and that nothing overlaps. Whether it is *readable* is not something a test
 * can see, and that part is his.
 */

/** Vertical air between one band and the next, and above the grid. */
const BAND_GAP = 90;
/** How many standalone notebooks sit in one row of the grid. */
const GRID_COLUMNS = 6;
const GRID_GAP = { x: 24, y: 20 };

/**
 * A titled region of the canvas.
 *
 * `role` rather than a finished string, so the drawing owns the wording — except for the
 * grid, which is not a role at all: "stands alone" is about having no relations, and the
 * three roles are about how a notebook is reached. Two different questions, and labelling
 * the grid "Neither" would put the same title on the canvas twice.
 */
export interface MapBand {
  key: string;
  role: MapRole | null;
  y: number;
  count: number;
}

export interface SystemLayout {
  nodes: Node[];
  edges: Edge[];
  /** How many were left out, so the button that shows them can say the number. */
  standaloneCount: number;
  /** Where to title each region, in flow coordinates. Empty regions are absent. */
  bands: MapBand[];
}

/** How far a `calls:` chip sits below and to the right of the notebook that owns it. */
const CHIP_OFFSET = { x: 26, y: 6 };

/**
 * Runs dagre over one band and returns the placed nodes plus the height they occupy.
 *
 * `chips` are not laid out by dagre at all. A chip belongs to exactly one notebook and
 * has to stay glued underneath it, which is not something a graph engine can be asked
 * for — so its owner is declared taller by the height of the chip, dagre keeps that space
 * clear, and the chip is dropped into it afterwards.
 */
function placeBand(
  nodes: Node[],
  edges: Edge[],
  chips: Map<string, Node>
): { nodes: Node[]; height: number } {
  if (nodes.length === 0) return { nodes: [], height: 0 };

  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: 'LR', nodesep: 24, ranksep: 70, marginx: 0, marginy: 0 });
  graph.setDefaultEdgeLabel(() => ({}));

  const reservedFor = (node: Node) => {
    const size = sizeFor(node);
    const chip = chips.get(node.id);
    return chip ? { ...size, height: size.height + CHIP_OFFSET.y + sizeFor(chip).height } : size;
  };

  const present = new Set(nodes.map((node) => node.id));
  // A fresh object per node: dagre writes the computed position into whatever it is
  // handed, so sharing one would place every node of that kind on top of the others.
  for (const node of nodes) graph.setNode(node.id, { ...reservedFor(node) });
  for (const edge of edges) {
    if (present.has(edge.source) && present.has(edge.target)) {
      graph.setEdge(edge.source, edge.target);
    }
  }

  dagre.layout(graph);

  let lowest = 0;
  const placed: Node[] = [];

  for (const node of nodes) {
    const at = graph.node(node.id);
    const size = sizeFor(node);
    const x = at.x - at.width / 2;
    const y = at.y - at.height / 2;
    lowest = Math.max(lowest, y + at.height);
    placed.push({ ...node, position: { x, y }, ...size });

    const chip = chips.get(node.id);
    if (chip) {
      placed.push({
        ...chip,
        position: { x: x + CHIP_OFFSET.x, y: y + size.height + CHIP_OFFSET.y },
        ...sizeFor(chip),
      });
    }
  }

  return { nodes: placed, height: lowest };
}

/** The shape for a set of things with no relations to each other. */
function placeGrid(nodes: Node[], top: number): { nodes: Node[]; height: number } {
  const { width, height } = SIZES.notebook;
  const placed = nodes.map((node, index) => ({
    ...node,
    position: {
      x: (index % GRID_COLUMNS) * (width + GRID_GAP.x),
      y: top + Math.floor(index / GRID_COLUMNS) * (height + GRID_GAP.y),
    },
    width,
    height,
  }));

  const rows = Math.ceil(nodes.length / GRID_COLUMNS);
  return { nodes: placed, height: rows === 0 ? 0 : rows * (height + GRID_GAP.y) - GRID_GAP.y };
}

/**
 * Places a whole system.
 *
 * `nodes` and `edges` come from `buildMapGraph`, which knows what exists; this decides
 * where it goes.
 */
export function layoutSystem(
  map: NotebookMap,
  nodes: Node[],
  edges: Edge[],
  { showStandalone = false }: { showStandalone?: boolean } = {}
): SystemLayout {
  const roles = mapRoles(map);
  const joined = connectedNotebooks(map);

  const notebookIdOf = (node: Node) =>
    node.type === 'mapNotebook' ? node.id.slice('notebook-'.length) : null;

  /**
   * Chips, pulled out and keyed by the notebook they belong under.
   *
   * They are passengers, not participants: they never enter a band on their own, they
   * never count towards anything, and they go wherever their owner went — including
   * nowhere, when the owner is one of the unconnected ones being hidden.
   */
  const chips = new Map<string, Node>();
  for (const node of nodes) {
    if (node.type === 'mapCalls') {
      chips.set(`notebook-${node.id.slice('calls-'.length)}`, node);
    }
  }
  const carried = nodes.filter((node) => node.type !== 'mapCalls');

  const alone = carried.filter((node) => {
    const id = notebookIdOf(node);
    return id !== null && !joined.has(id);
  });
  const standing = new Set(alone.map((node) => node.id));

  /**
   * Every edge survives hiding, and that is not an oversight.
   *
   * Only a notebook joined to nothing can be hidden — that is what "stands alone" means —
   * so hiding one can never orphan an arrow. I wrote a filter for it anyway, and a test
   * for the filter, and the test could not be made to fail: there is no input that
   * reaches it. A guard against an impossible state is a guard nobody can check.
   */
  const kept = showStandalone ? carried : carried.filter((node) => !standing.has(node.id));

  /**
   * Which band a node belongs to.
   *
   * A trigger sits with the notebook it fires — it is an attribute of that notebook
   * rather than a thing in its own right, and a band of its own would put the two ends of
   * one arrow in different regions.
   */
  const bandOf = (node: Node): MapRole => {
    const own = notebookIdOf(node);
    if (own) return roles.get(own) ?? 'idle';

    if (node.type === 'mapTrigger') {
      const trigger = map.triggers.find((entry) => `trigger-${entry.id}` === node.id);
      return trigger ? (roles.get(trigger.notebookId) ?? 'entry') : 'entry';
    }

    return 'idle';
  };

  const placedNodes: Node[] = [];
  const bands: SystemLayout['bands'] = [];
  let top = 0;

  for (const role of MAP_ROLE_ORDER) {
    // Standalone notebooks are laid out by the grid below, never by a band, even when
    // they are being shown — they are what made the bands 4531px tall.
    const inBand = kept.filter((node) => !standing.has(node.id) && bandOf(node) === role);
    if (inBand.length === 0) continue;

    const { nodes: placed, height } = placeBand(inBand, edges, chips);
    for (const node of placed) {
      placedNodes.push({ ...node, position: { x: node.position.x, y: node.position.y + top } });
    }
    bands.push({
      key: role,
      role,
      y: top,
      count: inBand.filter((node) => node.type === 'mapNotebook').length,
    });
    top += height + BAND_GAP;
  }

  if (showStandalone && alone.length > 0) {
    const { nodes: placed, height } = placeGrid(alone, top);
    placedNodes.push(...placed);
    bands.push({ key: 'alone', role: null, y: top, count: alone.length });
    top += height;
  }

  return { nodes: placedNodes, edges, standaloneCount: alone.length, bands };
}
