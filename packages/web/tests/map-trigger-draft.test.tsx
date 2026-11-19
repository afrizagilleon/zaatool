/**
 * FX15 / T-05 — the map shows a draft-only trigger as a draft.
 *
 * The engine now flags triggers that only the draft has (`draft: true`); the map node must
 * say so, because a bright trigger box with an animated arrow reads as "this is running".
 * Layout and colour are not measurable in jsdom, so this checks the words: the box names
 * itself a draft, and the deployed one does not.
 *
 *   pnpm --filter @zaa-tool/web test map-trigger-draft
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import type { NotebookMapTrigger } from '@zaa-tool/shared';
import { MapTriggerNode } from '../src/components/map/MapNodes';
import { buildMapGraph } from '../src/lib/map-graph';

function draw(trigger: NotebookMapTrigger) {
  const { nodes } = buildMapGraph({
    notebooks: [
      {
        id: trigger.notebookId,
        name: 'zz-fx15-map',
        runtime: 'node',
        inputs: [],
        outputs: [],
        secrets: [],
        packages: [],
        cellCount: 1,
        parallelCount: 0,
        deployed: true,
        updatedAt: '2026-11-19T00:00:00.000Z',
      },
    ],
    triggers: [trigger],
    calls: [],
  });
  const node = nodes.find((entry) => entry.type === 'mapTrigger');
  if (!node) throw new Error('the trigger was not drawn');

  render(
    <ReactFlowProvider>
      <MapTriggerNode {...({ data: node.data } as unknown as Parameters<typeof MapTriggerNode>[0])} />
    </ReactFlowProvider>
  );
  return node;
}

const base: NotebookMapTrigger = {
  id: 't1',
  notebookId: 'nb-1',
  kind: 'cron',
  label: '0 6 * * *',
  enabled: true,
};

describe('a trigger on the map', () => {
  it('says draft when only the draft has it', () => {
    draw({ ...base, draft: true });

    expect(screen.getByText(/draft/i)).toBeTruthy();
    expect(screen.getByTitle(/not active until deployed/i)).toBeTruthy();
  });

  it('says nothing of the sort for the one production is running', () => {
    draw(base);

    expect(screen.queryByText(/draft/i)).toBeNull();
    expect(screen.queryByTitle(/not active until deployed/i)).toBeNull();
  });

  it('keeps the flag on the node data the box is drawn from', () => {
    const node = draw({ ...base, draft: true });
    expect((node.data as { trigger: NotebookMapTrigger }).trigger.draft).toBe(true);
  });
});
