/** FX-26 — production, draft and pre-version runs say which document they executed. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { NotebookRunSummary, NotebookRunTrigger, NotebookVersionSummary } from '@zaa-tool/shared';
import { RunHistory } from './RunHistory';
import { notebooksApi } from '../../lib/notebooks-api';

vi.mock('../../lib/notebooks-api', () => ({
  notebooksApi: {
    clearRuns: vi.fn(),
    listRuns: vi.fn(),
    listVersions: vi.fn(),
  },
}));

function run(id: string, triggerSource: NotebookRunTrigger, versionId: string | null): NotebookRunSummary {
  return {
    id,
    notebook_id: 'zz-fx26-history',
    status: 'success',
    trigger_source: triggerSource,
    cell_id: null,
    parent_run_id: null,
    version_id: versionId,
    error: null,
    started_at: '2026-11-24T03:00:00.000Z',
    finished_at: '2026-11-24T03:00:01.000Z',
  };
}

const version: NotebookVersionSummary = {
  id: 'zz-fx26-version-2',
  number: 2,
  createdAt: '2026-11-24T02:00:00.000Z',
  deployedBy: 'zz-fx26-deployer',
  sourceVersionId: null,
  sourceNumber: null,
  isCurrent: true,
  name: 'zz-fx26-history',
  triggers: [],
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(notebooksApi.listVersions).mockResolvedValue([version]);
});

describe('run version labels', () => {
  it('shows a calculated version, draft, an honest dash for old production runs, and an id fallback', async () => {
    const user = userEvent.setup();
    vi.mocked(notebooksApi.listRuns).mockResolvedValue([
      run('zz-fx26-run-production', 'webhook', version.id),
      run('zz-fx26-run-draft', 'manual', null),
      run('zz-fx26-run-old', 'cron', null),
      run('zz-fx26-run-fallback', 'page', 'zz-fx26-version-not-loaded'),
    ]);

    render(<RunHistory notebookId="zz-fx26-history" activeRunId={null} refreshKey={0} onOpenRun={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Runs' }));

    expect(await screen.findByText('v2')).toBeTruthy();
    expect(screen.getByText('draft')).toBeTruthy();
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.getByText('zz-fx26-')).toBeTruthy();
    expect(notebooksApi.listVersions).toHaveBeenCalledTimes(1);
    expect(notebooksApi.listVersions).toHaveBeenCalledWith('zz-fx26-history');
  });
});
