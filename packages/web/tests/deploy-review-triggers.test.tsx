/**
 * FX15 / T-05 — the deploy review names the triggers a deploy switches on.
 *
 * The review is where the decision to deploy is made, so a cron that only goes live
 * because of this deploy has to be on it, marked as not active yet, and a trigger that
 * production already has has to stay off it.
 *
 *   pnpm --filter @zaa-tool/web test deploy-review-triggers
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { NotebookJson, NotebookTrigger } from '@zaa-tool/shared';
import { DeployReviewDialog } from '../src/components/notebook/DeployReviewDialog';
import { notebooksApi } from '../src/lib/notebooks-api';

vi.mock('../src/lib/notebooks-api', () => ({
  notebooksApi: {
    getById: vi.fn(),
    deployedDocument: vi.fn(),
    getRun: vi.fn(),
    deploy: vi.fn(),
  },
}));

const LABEL = /not active yet — deploy to activate/i;

const document = (triggers: NotebookTrigger[]): NotebookJson => ({
  version: '1.0',
  id: 'zz-fx15-review',
  name: 'zz-fx15-review',
  runtime: 'node',
  steps: [],
  triggers,
});

function review() {
  render(
    <DeployReviewDialog notebookId="zz-fx15-review" open onOpenChange={vi.fn()} onDeployed={vi.fn()} />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(notebooksApi.getRun).mockRejectedValue(new Error('never run'));
});

describe('the triggers a deploy would switch on', () => {
  it('lists a trigger the draft added, marked as not active yet', async () => {
    const live: NotebookTrigger = { id: 't1', kind: 'cron', cron: '0 6 * * *' };
    vi.mocked(notebooksApi.getById).mockResolvedValue(
      document([live, { id: 't2', kind: 'cron', cron: '*/5 * * * *' }])
    );
    vi.mocked(notebooksApi.deployedDocument).mockResolvedValue(document([live]));
    review();

    await waitFor(() => expect(screen.getAllByText(LABEL)).toHaveLength(1));
    // The new schedule's own row says it. The unchanged schedule is not listed as a
    // trigger being switched on (it can still appear in the settings diff above it).
    expect(screen.getByText('*/5 * * * *').closest('div')?.textContent).toMatch(LABEL);
  });

  it('lists every trigger when nothing was deployed before', async () => {
    vi.mocked(notebooksApi.getById).mockResolvedValue(
      document([{ id: 't1', kind: 'webhook', slug: 'zz-fx15-review-slug', secretKey: 'KEY' }])
    );
    vi.mocked(notebooksApi.deployedDocument).mockRejectedValue(new Error('Nothing deployed'));
    review();

    await waitFor(() => expect(screen.getAllByText(LABEL)).toHaveLength(1));
    expect(screen.getByText('/hooks/zz-fx15-review-slug')).toBeTruthy();
  });

  it('lists nothing when the draft carries only what is already deployed', async () => {
    const live: NotebookTrigger = { id: 't1', kind: 'cron', cron: '0 6 * * *' };
    vi.mocked(notebooksApi.getById).mockResolvedValue(document([live]));
    vi.mocked(notebooksApi.deployedDocument).mockResolvedValue(document([live]));
    review();

    await waitFor(() => expect(screen.getByText(/matches what is already deployed/i)).toBeTruthy());
    expect(screen.queryByText(LABEL)).toBeNull();
  });
});
