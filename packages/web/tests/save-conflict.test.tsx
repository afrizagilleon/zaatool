import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, renderHook, act } from '@testing-library/react';
import { SaveConflictBanner } from '../src/components/notebook/SaveConflictBanner';
import { useNotebookRun } from '../src/hooks/useNotebookRun';
import { useNotebookStore } from '../src/store/notebookStore';
import { notebooksApi, SaveConflictError } from '../src/lib/notebooks-api';
import type { NotebookJson } from '@zaa-tool/shared';

const CONFLICT = 'Somebody else saved this notebook first.';

const stored: NotebookJson = {
  version: '1.0',
  id: 'nb-1',
  name: 'Report',
  runtime: 'node',
  revision: 4,
  steps: [{ id: 'c1', kind: 'cell', code: 'return 1;' }],
};

function respond(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

describe('C-07: saving a notebook somebody else has saved since', () => {
  beforeEach(() => {
    useNotebookStore.getState().loadNotebook(stored);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('keeps the revision the notebook was opened at, and sends it with the save', () => {
    expect(useNotebookStore.getState().revision).toBe(4);
    expect(useNotebookStore.getState().getDocument().revision).toBe(4);
  });

  it('does not invent a revision for a notebook that was never saved', () => {
    useNotebookStore.getState().createNotebook('node');
    expect('revision' in useNotebookStore.getState().getDocument()).toBe(false);
  });

  it('turns the engine\'s 409 into a conflict the editor can tell from a failure', async () => {
    vi.stubGlobal('fetch', respond(409, { error: CONFLICT, code: 'conflict', currentRevision: 6 }));
    const failure = await notebooksApi.save(stored).catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(SaveConflictError);
    expect((failure as SaveConflictError).currentRevision).toBe(6);
    expect((failure as Error).message).toBe(CONFLICT);
  });

  it('a different 409 is still a plain error, not a conflict', async () => {
    vi.stubGlobal('fetch', respond(409, { error: 'Cannot deploy it.' }));
    const failure = await notebooksApi.save(stored).catch((err: unknown) => err);
    expect(failure).not.toBeInstanceOf(SaveConflictError);
  });

  it('a refused save keeps the editor\'s edits, says so, and saves nothing until a choice is made', async () => {
    const save = vi.spyOn(notebooksApi, 'save').mockRejectedValue(new SaveConflictError(CONFLICT, 6));
    const { result } = renderHook(() => useNotebookRun());

    await act(async () => {
      await expect(result.current.save()).rejects.toBeInstanceOf(SaveConflictError);
    });
    expect(useNotebookStore.getState().saveConflict).toEqual({ message: CONFLICT, currentRevision: 6 });
    expect(useNotebookStore.getState().revision).toBe(4);

    // A second press of Save must not be the thing that overwrites.
    save.mockClear();
    await act(async () => {
      await expect(result.current.save()).rejects.toThrow(CONFLICT);
    });
    expect(save).not.toHaveBeenCalled();
  });

  it('"save mine anyway" overwrites knowingly, from the revision the engine reported', async () => {
    useNotebookStore.getState().setSaveConflict(CONFLICT, 6);
    const save = vi.spyOn(notebooksApi, 'save').mockResolvedValue({ id: 'nb-1', name: 'Report', revision: 7 });
    const { result } = renderHook(() => useNotebookRun());

    await act(async () => {
      await result.current.overwriteStored();
    });
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0][0].revision).toBe(6);
    expect(useNotebookStore.getState().revision).toBe(7);
    expect(useNotebookStore.getState().saveConflict).toBeNull();
  });

  it('"reload theirs" opens what is stored and drops the conflict', async () => {
    useNotebookStore.getState().setSaveConflict(CONFLICT, 6);
    vi.spyOn(notebooksApi, 'getById').mockResolvedValue({ ...stored, name: 'Theirs', revision: 6 });
    const { result } = renderHook(() => useNotebookRun());

    await act(async () => {
      await result.current.reloadFromServer();
    });
    expect(useNotebookStore.getState().name).toBe('Theirs');
    expect(useNotebookStore.getState().revision).toBe(6);
    expect(useNotebookStore.getState().saveConflict).toBeNull();
  });
});

describe('SaveConflictBanner', () => {
  it('says what happened and offers both ways out', async () => {
    const onReload = vi.fn().mockResolvedValue(undefined);
    const onOverwrite = vi.fn().mockResolvedValue(undefined);
    render(<SaveConflictBanner message={CONFLICT} onReload={onReload} onOverwrite={onOverwrite} />);

    expect(screen.getByRole('alert').textContent).toContain(CONFLICT);
    expect(screen.getByRole('alert').textContent).toContain('not been saved');

    fireEvent.click(screen.getByText('Reload theirs'));
    await waitFor(() => expect(onReload).toHaveBeenCalledOnce());
    // Both buttons stay disabled until the first way out has finished; a click before that is
    // ignored, so wait for it rather than for the call alone.
    const overwrite = screen.getByText('Save mine anyway').closest('button') as HTMLButtonElement;
    await waitFor(() => expect(overwrite.disabled).toBe(false));
    fireEvent.click(overwrite);
    await waitFor(() => expect(onOverwrite).toHaveBeenCalledOnce());
  });

  it('shows why a way out failed instead of swallowing it', async () => {
    const onReload = vi.fn().mockRejectedValue(new Error('Engine unreachable'));
    render(<SaveConflictBanner message={CONFLICT} onReload={onReload} onOverwrite={vi.fn()} />);
    fireEvent.click(screen.getByText('Reload theirs'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Engine unreachable'));
  });
});
