import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AccessButton } from '../src/components/notebook/AccessDialog';
import { PageRunner } from '../src/components/pages/AppsPage';
import { notebooksApi } from '../src/lib/notebooks-api';
import type { NotebookPage } from '@zaa-tool/shared';

vi.mock('../src/lib/notebooks-api', () => ({
  notebooksApi: {
    access: vi.fn(),
    setAccess: vi.fn(),
    runDeployed: vi.fn(),
    runAction: vi.fn(),
    shares: vi.fn().mockResolvedValue([]),
  },
}));

const settings = {
  owner: { id: 'u1', username: 'owner' },
  editors: [{ id: 'u2', username: 'ed' }],
  appVisibility: 'all' as const,
  appUsers: [],
};

describe('Access dialog (FX-17)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('asks nothing until opened, then shows owner and editors', async () => {
    vi.mocked(notebooksApi.access).mockResolvedValue(settings);
    render(<AccessButton notebookId="nb1" notebookName="Report" />);
    expect(notebooksApi.access).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /access/i }));
    await waitFor(() => expect(screen.getByText('owner')).toBeTruthy());
    expect(screen.getByText('ed')).toBeTruthy();
  });

  it('sends editors, visibility and app users by username when saved', async () => {
    vi.mocked(notebooksApi.access).mockResolvedValue(settings);
    vi.mocked(notebooksApi.setAccess).mockResolvedValue(settings);
    render(<AccessButton notebookId="nb1" notebookName="Report" />);
    fireEvent.click(screen.getByRole('button', { name: /access/i }));
    await waitFor(() => screen.getByText('owner'));

    fireEvent.change(screen.getByLabelText('Username of a creator'), { target: { value: 'newbie' } });
    fireEvent.click(screen.getAllByRole('button', { name: /^add$/i })[0]);
    fireEvent.click(screen.getByLabelText('Only selected people'));
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'guest' } });
    fireEvent.click(screen.getAllByRole('button', { name: /^add$/i })[1]);
    fireEvent.click(screen.getByRole('button', { name: /save access/i }));

    await waitFor(() =>
      expect(notebooksApi.setAccess).toHaveBeenCalledWith('nb1', {
        editors: ['ed', 'newbie'],
        appVisibility: 'selected',
        appUsers: ['guest'],
      })
    );
  });

  it('shows the engine refusal and no controls when the caller is not the owner', async () => {
    vi.mocked(notebooksApi.access).mockRejectedValue(new Error('Only the owner can change who has access to a notebook.'));
    render(<AccessButton notebookId="nb1" notebookName="Report" />);
    fireEvent.click(screen.getByRole('button', { name: /access/i }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/only the owner/i));
    expect(screen.queryByRole('button', { name: /save access/i })).toBeNull();
  });

  it('offers Share only to people who work on the notebook', () => {
    const page: NotebookPage = {
      id: 'p', name: 'P', description: '', notes: [], inputs: [], outputs: [], layout: [], actions: [], tags: [],
    };
    const { rerender } = render(<PageRunner page={{ ...page, canEdit: false }} latest={page} onReload={() => {}} onBack={() => {}} />);
    expect(screen.queryByRole('button', { name: /share/i })).toBeNull();
    rerender(<PageRunner page={{ ...page, canEdit: true }} latest={page} onReload={() => {}} onBack={() => {}} />);
    expect(screen.getByRole('button', { name: /share/i })).toBeTruthy();
  });
});
