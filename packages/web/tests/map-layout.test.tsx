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
// Aliased: the DOM has a `Node` too, and in a jsdom test file that one wins.
import type { Node as FlowNode } from '@xyflow/react';
import { buildMapGraph, sizeFor, type CallsNodeData } from '../src/lib/map-graph';
import { extentOf } from '../src/lib/map-layout';

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
  const size = sizeFor(node as never);
  return {
    left: node.position.x,
    right: node.position.x + size.width,
    top: node.position.y,
    bottom: node.position.y + size.height,
  };
}

/** The `calls:` chip belonging to one notebook. Throws rather than returning undefined. */
function chipFor(layout: { nodes: FlowNode[] }, notebookId: string): CallsNodeData {
  const chip = layout.nodes.find((node) => node.id === `calls-${notebookId}`);
  expect(chip, `no calls chip for ${notebookId}`).toBeTruthy();
  return chip!.data as CallsNodeData;
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

    // Every notebook, plus the two triggers and the `calls:` chips those callers carry.
    expect(nodes.filter((node) => node.type === 'mapNotebook')).toHaveLength(33);
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

describe('using the width the screen has', () => {
  /** Thirteen schedules, each firing its own notebook. Thirteen unrelated pairs. */
  function schedules(count = 13): NotebookMap {
    return {
      notebooks: Array.from({ length: count }, (_, index) => notebook(String(index))),
      triggers: Array.from({ length: count }, (_, index) => ({
        id: `t${index}`,
        notebookId: String(index),
        kind: 'cron' as const,
        label: '0 9 * * *',
        enabled: true,
      })),
      calls: [],
    };
  }

  it('wraps a band into rows instead of drawing one column down the page', () => {
    // His report: a 600px-wide drawing down a 1700px-wide window. A band is not one
    // graph — thirteen trigger-and-notebook pairs have nothing to do with each other,
    // and depth is the only thing a layered engine spends width on.
    const { nodes } = buildMapGraph(schedules(), { width: 1600 });
    const columns = new Set(nodes.map((node) => Math.round(node.position.x)));

    expect(columns.size).toBeGreaterThan(2);
    const { width, height } = extent(nodes);
    expect(width).toBeGreaterThan(height);
  });

  it('gets shorter as the window gets wider, which is the whole point', () => {
    const narrow = extent(buildMapGraph(schedules(), { width: 700 }).nodes);
    const wide = extent(buildMapGraph(schedules(), { width: 1600 }).nodes);

    expect(wide.height).toBeLessThan(narrow.height);
    expect(wide.width).toBeGreaterThan(narrow.width);
  });

  it('never puts a chain past the width it was given', () => {
    const { nodes } = buildMapGraph(schedules(), { width: 900 });
    // One chain is a trigger and a notebook side by side, well under 900. Nothing should
    // start a row it cannot finish in.
    for (const node of nodes) {
      expect(node.position.x + (node.width ?? 0)).toBeLessThanOrEqual(900);
    }
  });

  it('still overlaps nothing once the rows are packed', () => {
    const boxes = buildMapGraph(schedules(), { width: 1000 }).nodes.map(box);
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

  it('shapes itself like the window, so fitting it draws bigger boxes', () => {
    // Packing to the window's *width* is not the same as filling the window. A drawing
    // wrapped at exactly the pane width still came out taller than the pane, and fitting
    // that has to zoom out until half the width is empty. What matters is the ratio.
    const pane = { width: 800, height: 700 };
    const zoomOf = (nodes: ReturnType<typeof buildMapGraph>['nodes']) => {
      const extent = extentOf(nodes);
      return Math.min(pane.width / extent.width, pane.height / extent.height);
    };

    const widthOnly = buildMapGraph(schedules(20), { width: pane.width });
    const shaped = buildMapGraph(schedules(20), pane);

    expect(zoomOf(shaped.nodes)).toBeGreaterThan(zoomOf(widthOnly.nodes));
  });

  it('keeps a chain together rather than wrapping through the middle of it', () => {
    // A trigger and the notebook it fires are one thing. Splitting them across a row
    // break would put an arrow's two ends on different lines.
    const { nodes } = buildMapGraph(schedules(3), { width: 700 });
    for (const trigger of nodes.filter((node) => node.type === 'mapTrigger')) {
      const fired = nodes.find(
        (node) => node.type === 'mapNotebook' && node.position.x > trigger.position.x
      );
      expect(fired).toBeTruthy();
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

    // It stopped being a box on the far side of a long arrow and became a red line on
    // the caller's own chip. It did not stop being said.
    const chip = chipFor(buildMapGraph(map), 'a');
    expect(chip.targets).toEqual([{ label: 'gone', notebookId: undefined, problem: 'missing' }]);
  });
});

describe('calls, which used to be a spider web', () => {
  /** Nine notebooks, four of them shared, thirteen calls between them. */
  function web(): NotebookMap {
    const shared = ['fx', 'tax', 'fmt', 'mail'];
    const callers: [string, string[]][] = [
      ['invoice', ['fx', 'tax', 'fmt']],
      ['payroll', ['tax', 'mail']],
      ['report', ['fx', 'fmt', 'mail']],
      ['daily', ['fx', 'tax', 'fmt', 'mail']],
      ['adhoc', ['fmt']],
    ];
    return {
      notebooks: [...shared, ...callers.map(([name]) => name)].map((id) => notebook(id)),
      triggers: [{ id: 't1', notebookId: 'daily', kind: 'cron', label: '@daily', enabled: true }],
      calls: callers.flatMap(([from, targets]) => targets.map((to) => call(from, to))),
    };
  }

  it('draws no notebook-to-notebook lines at all', () => {
    // Thirteen calls were thirteen long curves crossing every band, and it got worse the
    // more the system reused — which is exactly backwards. The only edges left are a
    // trigger to the notebook it fires, which is one short line between two neighbours.
    const { edges } = buildMapGraph(web(), { showStandalone: true });
    expect(edges.map((edge) => edge.id)).toEqual(['fires-t1']);
  });

  it('gives each caller one chip listing everything it calls', () => {
    const layout = buildMapGraph(web(), { showStandalone: true });
    expect(layout.nodes.filter((node) => node.type === 'mapCalls')).toHaveLength(5);
    expect(chipFor(layout, 'daily').targets.map((target) => target.label)).toEqual([
      'nb-fx',
      'nb-tax',
      'nb-fmt',
      'nb-mail',
    ]);
  });

  it('names the target rather than the reference the code happened to write', () => {
    const map = web();
    map.calls.push({ ...call('adhoc', 'fx'), reference: 'fx' });
    expect(chipFor(buildMapGraph(map, { showStandalone: true }), 'adhoc').targets).toContainEqual(
      expect.objectContaining({ label: 'nb-fx', notebookId: 'fx' })
    );
  });

  it('collapses a target called twice, because it is still one dependency', () => {
    const map = web();
    map.calls.push(call('adhoc', 'fmt'));
    expect(chipFor(buildMapGraph(map, { showStandalone: true }), 'adhoc').targets).toHaveLength(1);
  });

  it('hangs each chip directly under its own caller', () => {
    // Glued, not laid out: dagre has no idea a chip belongs to one particular box, so its
    // owner is declared taller and the chip is dropped into the space that reserves.
    const layout = buildMapGraph(web(), { showStandalone: true });
    for (const chip of layout.nodes.filter((node) => node.type === 'mapCalls')) {
      const owner = layout.nodes.find(
        (node) => node.id === `notebook-${chip.id.slice('calls-'.length)}`
      )!;
      expect(chip.position.y).toBeGreaterThan(owner.position.y);
      expect(chip.position.y - (owner.position.y + owner.height!)).toBeLessThan(20);
      expect(chip.position.x).toBeGreaterThan(owner.position.x);
    }
  });

  it('still leaves nothing overlapping once the chips are in', () => {
    const boxes = buildMapGraph(web(), { showStandalone: true }).nodes.map(box);
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
