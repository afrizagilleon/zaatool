/**
 * FX15 / T-05 — the trigger panel says which triggers are not active yet.
 *
 * Production listens to the *deployed* version's triggers, so a trigger that is only in
 * the draft does nothing until a deploy. Without a mark on it, people add a cron, wait,
 * and decide it is broken. These tests render the panel against a deployed version that
 * the draft disagrees with, and look at what is on the screen.
 *
 * jsdom measures nothing, so how the label *looks* is not checked here — only that it is
 * there for the triggers it should be on, and absent for the ones it should not.
 *
 *   pnpm --filter @zaa-tool/web test trigger-panel
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { NotebookDeployState, NotebookJson, NotebookTrigger } from '@zaa-tool/shared';
import { TriggerPanel } from '../src/components/notebook/TriggerPanel';
import { useNotebookStore } from '../src/store/notebookStore';
import { notebooksApi } from '../src/lib/notebooks-api';

vi.mock('../src/lib/notebooks-api', () => ({
  notebooksApi: { deployState: vi.fn(), deployedDocument: vi.fn() },
}));
// The announcement socket is not what is under test, and it would try to open one.
vi.mock('../src/hooks/useCatalogRefresh', () => ({ useCatalogRefresh: () => true }));
// Both children fetch from the engine for things this file does not look at.
vi.mock('../src/components/schedule/ScheduleEditor', () => ({
  ScheduleEditor: ({ value }: { value: string }) => <code>{value}</code>,
}));
vi.mock('../src/components/resources/SecretPicker', () => ({
  SecretPicker: ({ value }: { value?: string }) => <span>secret:{value ?? 'none'}</span>,
}));

const LABEL = /not active yet — deploy to activate/i;

const cron = (id: string, expression: string, enabled = true): NotebookTrigger => ({
  id,
  kind: 'cron',
  cron: expression,
  enabled,
});

const hook = (id: string, slug: string, secretKey?: string): NotebookTrigger => ({
  id,
  kind: 'webhook',
  slug,
  enabled: true,
  ...(secretKey ? { secretKey } : {}),
});

function deployed(triggers: NotebookTrigger[] | null) {
  vi.mocked(notebooksApi.deployState).mockResolvedValue({
    isDeployed: triggers !== null,
  } as NotebookDeployState);
  vi.mocked(notebooksApi.deployedDocument).mockResolvedValue({
    triggers: triggers ?? [],
  } as NotebookJson);
}

function panel(triggers: NotebookTrigger[]) {
  render(
    <TriggerPanel
      triggers={triggers}
      isSaved
      onAdd={vi.fn()}
      onUpdate={vi.fn()}
      onRemove={vi.fn()}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useNotebookStore.setState({ id: 'zz-fx15-trigger-panel' });
});

describe('triggers that production is not listening to yet', () => {
  it('marks a trigger only the draft has, and not the one both have', async () => {
    deployed([cron('t-live', '0 6 * * *')]);
    panel([cron('t-live', '0 6 * * *'), cron('t-new', '*/5 * * * *')]);

    await waitFor(() => expect(screen.getAllByText(LABEL)).toHaveLength(1));
    // The mark is on the new schedule's card, not the unchanged one's.
    const newCard = screen.getByText('*/5 * * * *').closest('div.border');
    const liveCard = screen.getByText('0 6 * * *').closest('div.border');
    expect(newCard?.textContent).toMatch(LABEL);
    expect(liveCard?.textContent).not.toMatch(LABEL);
  });

  it('marks a trigger whose secret was removed in the draft', async () => {
    deployed([hook('t1', 'zz-fx15-slug', 'KEY')]);
    panel([hook('t1', 'zz-fx15-slug')]);

    await waitFor(() => expect(screen.getAllByText(LABEL)).toHaveLength(1));
  });

  it('marks a trigger whose schedule changed in the draft', async () => {
    deployed([cron('t1', '0 6 * * *')]);
    panel([cron('t1', '0 7 * * *')]);

    await waitFor(() => expect(screen.getAllByText(LABEL)).toHaveLength(1));
  });

  it('marks nothing when the draft matches the deployed version exactly', async () => {
    deployed([cron('t1', '0 6 * * *'), hook('t2', 'zz-fx15-slug', 'KEY')]);
    panel([cron('t1', '0 6 * * *'), hook('t2', 'zz-fx15-slug', 'KEY')]);

    await waitFor(() => expect(notebooksApi.deployedDocument).toHaveBeenCalled());
    expect(screen.queryByText(LABEL)).toBeNull();
  });

  it('marks every enabled trigger of a notebook nobody has deployed', async () => {
    deployed(null);
    panel([cron('t1', '0 6 * * *'), cron('t2', '0 7 * * *', false)]);

    await waitFor(() => expect(screen.getAllByText(LABEL)).toHaveLength(1));
    // The switched-off one has nothing to activate, so it carries no mark.
    const offCard = screen.getByText('0 7 * * *').closest('div.border');
    expect(offCard?.textContent).not.toMatch(LABEL);
  });

  it('says nothing while it does not know what is deployed', async () => {
    vi.mocked(notebooksApi.deployState).mockRejectedValue(new Error('offline'));
    panel([cron('t1', '0 6 * * *')]);

    await waitFor(() => expect(notebooksApi.deployState).toHaveBeenCalled());
    expect(screen.queryByText(LABEL)).toBeNull();
  });
});
