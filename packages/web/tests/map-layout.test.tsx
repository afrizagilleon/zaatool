/**
 * FX6 — the map was a ribbon.
 *
 * Measured before anything was changed: a workspace of thirty-three notebooks laid out
 * **4531px tall** and 1050px wide, in five columns. Half a minute of scrolling to see a
 * system, which is the opposite of what a map is for.
 *
 * The cause was not dagre being bad at graphs. Twenty-nine of those notebooks have no
 * edges at all, and a layered graph engine has nothing to say about a node with no
 * relations — they all land in rank 0 and stack downwards forever. Laying out unrelated
 * things with a tool meant for related things is the whole bug.
 *
 * Layout is a pure function, so this is measurable rather than a matter of taste: height,
 * overlap, band order, and what happens to an arrow when one of its ends is hidden.
 * Whether the result is *readable* is not something a test can see, and that part is his.
 *
 *   pnpm --filter @zaa-tool/web test map-layout
 */
import { describe, expect, it } from 'vitest';
import type { NotebookMap, NotebookMapNotebook } from '@zaa-tool/shared';
import { buildMapGraph, SIZES } from '../src/lib/map-graph';

function notebook(id: string, over: Partial<NotebookMapNotebook> = {}): NotebookMapNotebook {
  return {
    id,
    name: `nb-${id}`,
    runtime: 'node',
    inputs: [],
    outputs: [],
    secrets: [],
    packages: [],
    cellCount: 3,
    parallelCount: 0,
    deployed: false,
    updatedAt: '2026-08-06T00:00:00.000Z',
    ...over,
  };
}

const call = (from: string, to: string) => ({
  fromNotebookId: from,
  fromCellId: 'c1',
  reference: `nb-${to}`,
  toNotebookId: to,
  resolved: true,
  dynamic: false,
  ambiguous: false,
});

/** His workspace in shape if not in detail: a few joined, most standing alone. */
function workspace(size = 33): NotebookMap {
  return {
    notebooks: Array.from({ length: size }, (_, index) => notebook(String(index))),
    triggers: [
      { id: 't1', notebookId: '0', kind: 'cron', label: '0 9 * * *', enabled: true },
      { id: 't2', notebookId: '1', kind: 'webhook', label: '/hooks/x', enabled: true },
    ],
    calls: [call('0', '2'), call('2', '3')],
  };
}

/** The box that would be drawn for a placed node. */
function box(node: { type?: string; position: { x: number; y: number } }) {
  const size =
    node.type === 'mapTrigger'
      ? SIZES.trigger
      : node.type === 'mapUnresolved'
        ? SIZES.unresolved
        : SIZES.notebook;
  return {
    left: node.position.x,
    right: node.position.x + size.width,
    top: node.position.y,
    bottom: node.position.y + size.height,
  };
}

function extent(nodes: { position: { x: number; y: number } }[]) {
  const xs = nodes.map((node) => node.position.x);
  const ys = nodes.map((node) => node.position.y);
  return { width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

describe('a system that fits on a screen', () => {
  it('is not a ribbon any more', () => {
    // The number that made this milestone necessary was 4531. Anything near it is the
    // old behaviour returning, whatever the code looks like.
    const { height } = extent(buildMapGraph(workspace()).nodes);
    expect(height).toBeLessThan(400);
  });

  it('still fits when every standalone notebook is asked for', () => {
    const { nodes } = buildMapGraph(workspace(), { showStandalone: true });
    const { width, height } = extent(nodes);

    expect(nodes).toHaveLength(35);
    // Wider than tall, because a screen is. The old layout was four times taller than
    // wide, which is the shape of a list pretending to be a map.
    expect(height).toBeLessThan(width);
    expect(height).toBeLessThan(900);
  });

  it('leaves the unrelated ones out until they are asked for, and says how many', () => {
    const hidden = buildMapGraph(workspace());
    expect(hidden.standaloneCount).toBe(29);
    expect(hidden.nodes.filter((node) => node.type === 'mapNotebook')).toHaveLength(4);
  });

  it('never draws two boxes on top of each other', () => {
    // Dagre guarantees this inside one run. Three runs stacked by hand do not get it for
    // free, and an overlap is the failure mode you cannot see until the screenshot.
    const boxes = buildMapGraph(workspace(), { showStandalone: true }).nodes.map(box);

    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i];
        const b = boxes[j];
        const overlaps =
          a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        expect(overlaps, `nodes ${i} and ${j} overlap`).toBe(false);
      }
    }
  });
});

describe('the three regions', () => {
  it('reads downwards: what starts, what it reaches, what it does not', () => {
    const map = workspace();
    map.notebooks.push(notebook('x'));
    map.calls.push(call('x', '0'));

    const { bands } = buildMapGraph(map, { showStandalone: true });
    expect(bands.map((band) => band.key)).toEqual(['entry', 'reused', 'idle', 'alone']);
    // Strictly downwards, so the titles cannot end up above the region they name.
    for (let i = 1; i < bands.length; i += 1) {
      expect(bands[i].y).toBeGreaterThan(bands[i - 1].y);
    }
  });

  it('does not title a region that has nothing in it', () => {
    const bare: NotebookMap = { notebooks: [notebook('a')], triggers: [], calls: [] };
    expect(buildMapGraph(bare, { showStandalone: true }).bands.map((band) => band.key)).toEqual([
      'alone',
    ]);
  });

  it('keeps a trigger in the band of the notebook it fires', () => {
    // A trigger is an attribute of its notebook, not a thing in its own right. In a band
    // of its own the arrow would have its two ends in different regions.
    const { nodes, bands } = buildMapGraph(workspace());
    const entry = bands.find((band) => band.key === 'entry');
    const reused = bands.find((band) => band.key === 'reused');
    const trigger = nodes.find((node) => node.type === 'mapTrigger');

    expect(trigger!.position.y).toBeGreaterThanOrEqual(entry!.y);
    expect(trigger!.position.y).toBeLessThan(reused!.y);
  });
});

describe('hiding, and what it may never hide', () => {
  it('only ever hides a notebook that is joined to nothing', () => {
    // Which is why no arrow can be orphaned by hiding: an edge means joined, and joined
    // means shown. I wrote a filter for orphaned edges anyway and could not make its test
    // fail — there is no input that reaches it — so the filter is gone rather than sitting
    // there being untestable.
    const map: NotebookMap = {
      notebooks: [notebook('a'), notebook('b'), notebook('lonely')],
      triggers: [],
      calls: [call('a', 'b')],
    };

    const { nodes, edges } = buildMapGraph(map);
    const ids = new Set(nodes.map((node) => node.id));
    expect(ids.has('notebook-lonely')).toBe(false);
    for (const edge of edges) {
      expect(ids.has(edge.source) && ids.has(edge.target)).toBe(true);
    }
  });

  it('keeps a call that resolves to nothing, because that is the point of a derived map', () => {
    const map: NotebookMap = {
      notebooks: [notebook('a')],
      triggers: [{ id: 't', notebookId: 'a', kind: 'cron', label: '@daily', enabled: true }],
      calls: [
        {
          fromNotebookId: 'a',
          fromCellId: 'c1',
          reference: 'gone',
          toNotebookId: null,
          resolved: false,
          dynamic: false,
          ambiguous: false,
        },
      ],
    };

    const { nodes, edges } = buildMapGraph(map);
    expect(nodes.some((node) => node.type === 'mapUnresolved')).toBe(true);
    expect(edges.some((edge) => edge.className === 'map-edge-unresolved')).toBe(true);
  });
});
