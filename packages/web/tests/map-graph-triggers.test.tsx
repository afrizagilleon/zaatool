/**
 * B-01 — one trigger id, five notebooks.
 *
 * `NotebookMapTrigger.id` is scoped to its notebook: every notebook numbers its own
 * triggers from `t1`, so `t1` is not a name, it is a position. `buildMapGraph` used it
 * as a React Flow element id anyway, and React Flow treats a repeated id as the same
 * element — measured against the live workspace, thirteen triggers shared five ids, so
 * four of five cron jobs simply were not on the map, and the survivor's edge leaked into
 * an unrelated notebook's view as a stray arrow pointing at nothing.
 *
 * The fixture below is that bug in miniature: two notebooks, `t1` in both. Reverting the
 * namespacing in `buildMapGraph` makes this file fail on the first length assertion.
 *
 *   pnpm --filter @zaa-tool/web test map-graph-triggers
 */
import { describe, expect, it } from 'vitest';
import type { NotebookMap, NotebookMapNotebook } from '@zaa-tool/shared';
import { buildMapGraph } from '../src/lib/map-graph';

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
    deployed: true,
    updatedAt: '2026-08-09T00:00:00.000Z',
    ...over,
  };
}

/** Two notebooks that each call their own first trigger `t1`, which is the normal case. */
function collidingIds(): NotebookMap {
  return {
    notebooks: [notebook('nb-1'), notebook('nb-2')],
    triggers: [
      { id: 't1', notebookId: 'nb-1', kind: 'cron', label: '0 * * * *', enabled: true },
      { id: 't1', notebookId: 'nb-2', kind: 'cron', label: '0 0 * * *', enabled: true },
    ],
    calls: [],
  };
}

describe('trigger ids, which are only unique inside one notebook', () => {
  it('draws both triggers when two notebooks each have a t1', () => {
    const { nodes, edges } = buildMapGraph(collidingIds());

    const triggerNodes = nodes.filter((node) => node.type === 'mapTrigger');
    const triggerEdges = edges.filter((edge) => edge.id.startsWith('fires-'));

    // Before the fix these were 1 and 1: the second trigger overwrote the first.
    expect(triggerNodes).toHaveLength(2);
    expect(triggerEdges).toHaveLength(2);

    expect(new Set(triggerNodes.map((node) => node.id)).size).toBe(2);
    expect(new Set(triggerEdges.map((edge) => edge.id)).size).toBe(2);
  });

  it('names each element after the notebook it belongs to', () => {
    const { nodes, edges } = buildMapGraph(collidingIds());

    expect(nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining(['trigger-nb-1-t1', 'trigger-nb-2-t1'])
    );
    expect(edges.map((edge) => edge.id)).toEqual(['fires-nb-1-t1', 'fires-nb-2-t1']);
  });

  it('still points each trigger at its own notebook', () => {
    const { edges } = buildMapGraph(collidingIds());

    expect(edges.map((edge) => [edge.source, edge.target])).toEqual([
      ['trigger-nb-1-t1', 'notebook-nb-1'],
      ['trigger-nb-2-t1', 'notebook-nb-2'],
    ]);
  });
});
