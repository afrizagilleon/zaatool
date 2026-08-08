import { describe, expect, it } from 'vitest';
import { buildMapGraph } from '../src/lib/map-graph';
import type { NotebookMap } from '@zaa-tool/shared';

describe('System Map Trigger Node & Edge IDs (T-04 / B-01)', () => {
  it('creates unique node and edge IDs when multiple notebooks share local trigger IDs', () => {
    const mockMap: NotebookMap = {
      notebooks: [
        {
          id: 'nb-1',
          name: 'Notebook 1',
          runtime: 'node',
          inputs: [],
          outputs: [],
          hasTriggers: true,
          deployed: true,
        },
        {
          id: 'nb-2',
          name: 'Notebook 2',
          runtime: 'node',
          inputs: [],
          outputs: [],
          hasTriggers: true,
          deployed: true,
        },
      ],
      triggers: [
        {
          id: 't1',
          notebookId: 'nb-1',
          kind: 'cron',
          cron: '0 * * * *',
          enabled: true,
        },
        {
          id: 't1',
          notebookId: 'nb-2',
          kind: 'cron',
          cron: '0 0 * * *',
          enabled: true,
        },
      ],
      calls: [],
    };

    const layout = buildMapGraph(mockMap);
    const triggerNodes = layout.nodes.filter((n) => n.type === 'mapTrigger');
    const triggerEdges = layout.edges.filter((e) => e.id.startsWith('fires-'));

    expect(triggerNodes).toHaveLength(2);
    expect(triggerEdges).toHaveLength(2);

    const nodeIds = new Set(triggerNodes.map((n) => n.id));
    const edgeIds = new Set(triggerEdges.map((e) => e.id));

    expect(nodeIds.size).toBe(2);
    expect(edgeIds.size).toBe(2);

    expect(nodeIds.has('trigger-nb-1-t1')).toBe(true);
    expect(nodeIds.has('trigger-nb-2-t1')).toBe(true);
    expect(edgeIds.has('fires-nb-1-t1')).toBe(true);
    expect(edgeIds.has('fires-nb-2-t1')).toBe(true);
  });
});
