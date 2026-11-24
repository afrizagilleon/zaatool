/**
 * FX-26 — a person can review and confirm a rollback in the real production dialog.
 *
 * The API is mocked, but the version list, behavioural diff, trigger warnings and
 * confirmation button are the components the editor renders. Fixtures use `zz-fx26-ui-`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { NotebookJson, NotebookVersionSummary } from '@zaa-tool/shared';
import { ProductionDialog } from './ProductionDialog';
import { notebooksApi } from '../../lib/notebooks-api';

vi.mock('../../lib/notebooks-api', () => ({
  notebooksApi: {
    deployedDocument: vi.fn(),
    getVersion: vi.fn(),
    listVersions: vi.fn(),
    redeployVersion: vi.fn(),
    undeploy: vi.fn(),
  },
}));

const currentDocument: NotebookJson = {
  version: '1.0',
  id: 'zz-fx26-ui-notebook',
  name: 'zz-fx26-ui-current',
  runtime: 'node',
  triggers: [{ id: 'zz-fx26-ui-new-hook', kind: 'webhook', slug: 'zz-fx26-ui-new' }],
  steps: [{ id: 'zz-fx26-ui-cell', kind: 'cell', code: "return { marker: 'new' };" }],
};

const historicalDocument: NotebookJson = {
  ...currentDocument,
  name: 'zz-fx26-ui-old',
  secrets: ['ZZ_FX26_UI_SECRET'],
  triggers: [{ id: 'zz-fx26-ui-old-cron', kind: 'cron', cron: '0 9 * * *' }],
  steps: [{ id: 'zz-fx26-ui-cell', kind: 'cell', code: "return { marker: 'old' };" }],
};

function summary(number: number, isCurrent: boolean): NotebookVersionSummary {
  return {
    id: `zz-fx26-ui-version-${number}`,
    number,
    createdAt: `2026-11-24T0${number}:00:00.000Z`,
    deployedBy: 'zz-fx26-ui-deployer',
    sourceVersionId: null,
    sourceNumber: null,
    isCurrent,
    name: number === 1 ? historicalDocument.name : currentDocument.name,
    triggers: [],
  };
}

function dialog(isDeployed = true, onChanged: () => void = () => {}) {
  return render(
    <ProductionDialog
      notebookId="zz-fx26-ui-notebook"
      serving={undefined}
      deployedAt={isDeployed ? '2026-11-24T02:00:00.000Z' : null}
      isDeployed={isDeployed}
      open
      onOpenChange={() => {}}
      onUndeployed={() => {}}
      onChanged={onChanged}
    />
  );
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('production rollback', () => {
  it('renders the API history, reviews the consequences, and redeploys the selected id', async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    const rolledBack = { ...summary(3, true), sourceVersionId: 'zz-fx26-ui-version-1', sourceNumber: 1 };
    vi.mocked(notebooksApi.listVersions)
      .mockResolvedValueOnce([summary(2, true), summary(1, false)])
      .mockResolvedValueOnce([rolledBack, summary(2, false), summary(1, false)]);
    vi.mocked(notebooksApi.deployedDocument)
      .mockResolvedValueOnce(currentDocument)
      .mockResolvedValueOnce(historicalDocument);
    vi.mocked(notebooksApi.getVersion).mockResolvedValue(historicalDocument);
    vi.mocked(notebooksApi.redeployVersion).mockResolvedValue({ versionId: rolledBack.id });

    dialog(true, changed);
    expect((await screen.findByRole('button', { name: 'Review v2' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(await screen.findByRole('button', { name: 'Review v1' }));

    expect(await screen.findByText(/Production will use your secrets/)).toBeTruthy();
    expect(screen.getByText('Name')).toBeTruthy();
    expect(screen.getByText('Starts:')).toBeTruthy();
    expect(screen.getByText('Stops:')).toBeTruthy();
    expect(screen.getAllByText(/return \{ marker: 'old' \}/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Your draft will not change/).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Make v1 production' }));
    await waitFor(() => {
      expect(notebooksApi.redeployVersion).toHaveBeenCalledWith(
        'zz-fx26-ui-notebook',
        'zz-fx26-ui-version-1'
      );
    });
    expect(changed).toHaveBeenCalledTimes(1);
    expect((await screen.findByRole('button', { name: 'Review v3' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Rollback from v1')).toBeTruthy();
  });

  it('still offers a historical version when nothing is currently deployed', async () => {
    const user = userEvent.setup();
    vi.mocked(notebooksApi.listVersions).mockResolvedValue([summary(1, false)]);
    vi.mocked(notebooksApi.getVersion).mockResolvedValue(historicalDocument);

    dialog(false);
    expect(screen.queryByRole('button', { name: 'Take out of production' })).toBeNull();
    await user.click(await screen.findByRole('button', { name: 'Review v1' }));

    expect(await screen.findByText('Nothing is deployed now. Confirming starts production with this version.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Make v1 production' })).toBeTruthy();
    expect(notebooksApi.deployedDocument).not.toHaveBeenCalled();
  });
});
