import dagre from 'dagre';
import type { Edge, Node } from '@xyflow/react';
import {
  MAP_ROLE_LABELS,
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
const GRID_GAP = { x: 24, y: 20 };

/**
 * How wide the drawing may grow before it wraps to a new row.
 *
 * A default rather than a constant: the map measures its own pane and passes the real
 * number. This one is for tests and for the first frame, before anything has been measured.
 */
const DEFAULT_WIDTH = 1200;

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

interface Placed {
  nodes: Node[];
  width: number;
  height: number;
}

/**
 * Lays out one connected chain and normalises it to its own origin.
 *
 * `chips` are not laid out by dagre at all. A chip belongs to exactly one notebook and
 * has to stay glued underneath it, which is not something a graph engine can be asked
 * for — so its owner is declared taller by the height of the chip, dagre keeps that space
 * clear, and the chip is dropped into it afterwards.
 */
function placeChain(nodes: Node[], edges: Edge[], chips: Map<string, Node>): Placed {
  if (nodes.length === 0) return { nodes: [], width: 0, height: 0 };

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

  const placed: Node[] = [];
  let left = Infinity;
  let top = Infinity;
  let right = 0;
  let bottom = 0;

  for (const node of nodes) {
    const at = graph.node(node.id);
    const size = sizeFor(node);
    const x = at.x - at.width / 2;
    const y = at.y - at.height / 2;
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x + at.width);
    bottom = Math.max(bottom, y + at.height);
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

  // Moved to its own origin so packing only has to think about width and height.
  for (const node of placed) {
    node.position = { x: node.position.x - left, y: node.position.y - top };
  }

  return { nodes: placed, width: right - left, height: bottom - top };
}

/**
 * The chains inside a band, each one separate from the others.
 *
 * A band is not one graph. "Starts on its own" is thirteen unrelated pairs — a trigger and
 * the notebook it fires — that have nothing to do with each other, and handing all
 * thirteen to dagre at once produces exactly two columns and thirteen rows, because depth
 * is the only thing a layered engine spends width on. That is the same mistake as FX6's
 * ribbon, one level down: laying out unrelated things with a tool for related things.
 */
function chainsIn(nodes: Node[], edges: Edge[]): Node[][] {
  const index = new Map(nodes.map((node, at) => [node.id, at]));
  const parent = nodes.map((_, at) => at);

  const root = (at: number): number => {
    while (parent[at] !== at) {
      parent[at] = parent[parent[at]];
      at = parent[at];
    }
    return at;
  };

  for (const edge of edges) {
    const from = index.get(edge.source);
    const to = index.get(edge.target);
    if (from === undefined || to === undefined) continue;
    parent[root(from)] = root(to);
  }

  // Keyed in first-seen order, so the drawing is stable between renders rather than
  // reshuffling every time the map is refetched.
  const chains = new Map<number, Node[]>();
  nodes.forEach((node, at) => {
    const key = root(at);
    const chain = chains.get(key) ?? [];
    chain.push(node);
    chains.set(key, chain);
  });

  return [...chains.values()];
}

/**
 * Packs a band's chains left to right, wrapping when the row runs out of width.
 *
 * The screen is wider than it is tall and the old layout used none of that: a system of
 * thirteen schedules drew a 600px-wide column down a 1700px-wide window. Rows are as tall
 * as their tallest chain, which keeps the bands' titles honest about where each begins.
 */
function placeBand(
  nodes: Node[],
  edges: Edge[],
  chips: Map<string, Node>,
  targetWidth: number
): { nodes: Node[]; height: number } {
  if (nodes.length === 0) return { nodes: [], height: 0 };

  const chains = chainsIn(nodes, edges).map((chain) => placeChain(chain, edges, chips));

  const placed: Node[] = [];
  let x = 0;
  let rowTop = 0;
  let rowHeight = 0;

  for (const chain of chains) {
    // Always at least one per row: a chain wider than the window still has to go
    // somewhere, and wrapping before the first one would leave an empty row.
    if (x > 0 && x + chain.width > targetWidth) {
      rowTop += rowHeight + GRID_GAP.y * 2;
      rowHeight = 0;
      x = 0;
    }

    for (const node of chain.nodes) {
      placed.push({
        ...node,
        position: { x: node.position.x + x, y: node.position.y + rowTop },
      });
    }

    x += chain.width + GRID_GAP.x * 2;
    rowHeight = Math.max(rowHeight, chain.height);
  }

  return { nodes: placed, height: rowTop + rowHeight };
}

/**
 * The shape for a set of things with no relations to each other.
 *
 * Columns come from the width available rather than a fixed six, for the same reason the
 * bands wrap: six was a guess that wasted half a wide window and overflowed a narrow one.
 */
function placeGrid(nodes: Node[], top: number, targetWidth: number): { nodes: Node[]; height: number } {
  const { width, height } = SIZES.notebook;
  const columns = Math.max(1, Math.floor((targetWidth + GRID_GAP.x) / (width + GRID_GAP.x)));

  const placed = nodes.map((node, index) => ({
    ...node,
    position: {
      x: (index % columns) * (width + GRID_GAP.x),
      y: top + Math.floor(index / columns) * (height + GRID_GAP.y),
    },
    width,
    height,
  }));

  const rows = Math.ceil(nodes.length / columns);
  return { nodes: placed, height: rows === 0 ? 0 : rows * (height + GRID_GAP.y) - GRID_GAP.y };
}

/**
 * Places a whole system.
 *
 * `nodes` and `edges` come from `buildMapGraph`, which knows what exists; this decides
 * where it goes.
 */
/** The box every node in a layout fits inside. */
export function extentOf(nodes: Node[]): { width: number; height: number } {
  if (nodes.length === 0) return { width: 0, height: 0 };
  return {
    width: Math.max(...nodes.map((node) => node.position.x + (node.width ?? 0))),
    height: Math.max(...nodes.map((node) => node.position.y + (node.height ?? 0))),
  };
}

/**
 * Lays out several times and keeps the one shaped most like the window.
 *
 * Packing to the window's *width* is not the same as filling the window. Wrapping at
 * exactly 1264px produced a drawing 1562 wide and 1467 tall on his workspace — and since
 * the pane is wider than it is tall, fitting that still had to zoom out until half the
 * width was empty. What matters is the ratio, not the width.
 *
 * So it tries a few, cheaply: the layout is a pure function of the same nodes, and four
 * calls of it cost less than one fetch. Letting a candidate grow wider than the pane is
 * deliberate — fitting shrinks it back, and a wide short drawing survives that better than
 * a tall narrow one.
 */
export function layoutForViewport(
  map: NotebookMap,
  nodes: Node[],
  edges: Edge[],
  options: { showStandalone?: boolean; width: number; height: number }
): SystemLayout {
  const wanted = options.width / options.height;
  let best: { layout: SystemLayout; miss: number } | null = null;

  for (const factor of [1, 1.4, 2, 2.8]) {
    const layout = layoutSystem(map, nodes, edges, {
      showStandalone: options.showStandalone,
      width: options.width * factor,
    });
    const extent = extentOf(layout.nodes);
    if (extent.height === 0) return layout;

    // Compared as a log ratio so "twice as wide as it should be" and "half as wide" count
    // the same. Comparing the difference would quietly prefer the taller one every time.
    const miss = Math.abs(Math.log(extent.width / extent.height / wanted));
    if (!best || miss < best.miss) best = { layout, miss };
  }

  return best!.layout;
}

export function layoutSystem(
  map: NotebookMap,
  nodes: Node[],
  edges: Edge[],
  {
    showStandalone = false,
    width: targetWidth = DEFAULT_WIDTH,
  }: { showStandalone?: boolean; width?: number } = {}
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

    const { nodes: placed, height } = placeBand(inBand, edges, chips, targetWidth);
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
    const { nodes: placed, height } = placeGrid(alone, top, targetWidth);
    placedNodes.push(...placed);
    bands.push({ key: 'alone', role: null, y: top, count: alone.length });
    top += height;
  }

  return { nodes: placedNodes, edges, standaloneCount: alone.length, bands };
}

/** Exported for the tests, which check the canvas and the agent use the same words. */
export const BAND_TITLES = MAP_ROLE_ORDER.map((role) => MAP_ROLE_LABELS[role]);

