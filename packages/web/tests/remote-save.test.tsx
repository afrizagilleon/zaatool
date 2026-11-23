import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import type { CatalogChangedEvent, NotebookJson } from '@zaa-tool/shared';
import { decideRemoteSave } from '../src/lib/remote-save';
import { RemoteChangeBanner } from '../src/components/notebook/RemoteChangeBanner';
import { useRemoteSaveWatch } from '../src/hooks/useRemoteSaveWatch';
import { useNotebookStore } from '../src/store/notebookStore';

let emit: (e: CatalogChangedEvent) => void = () => {};
vi.mock('../src/lib/watch-socket', () => ({
  watchCatalog: (listener: (e: CatalogChangedEvent) => void) => {
    emit = listener;
    return () => {};
  },
}));

const doc: NotebookJson = {
  version: '1.0',
  id: 'nb-1',
  name: 'Report',
  runtime: 'node',
  revision: 4,
  steps: [{ id: 'c1', kind: 'cell', code: 'return 1;' }],
};
const saved = (revision: number | undefined, extra: Partial<CatalogChangedEvent> = {}): CatalogChangedEvent => ({
  type: 'catalog:changed',
  change: 'saved',
  notebookId: 'nb-1',
  revision,
  ...extra,
});
const idle = { id: 'nb-1', revision: 4, isDirty: false, isSaving: false };

describe('decideRemoteSave', () => {
  it('ignores the own save of the editor and anything older', () => {
    expect(decideRemoteSave(idle, saved(4))).toBe('ignore');
    expect(decideRemoteSave(idle, saved(3))).toBe('ignore');
  });
  it('ignores other notebooks, other changes, a missing revision and a save in flight', () => {
    expect(decideRemoteSave(idle, saved(5, { notebookId: 'other' }))).toBe('ignore');
    expect(decideRemoteSave(idle, saved(5, { change: 'deployed' }))).toBe('ignore');
    expect(decideRemoteSave(idle, saved(undefined))).toBe('ignore');
    expect(decideRemoteSave({ ...idle, isSaving: true }, saved(5))).toBe('ignore');
  });
  it('reloads when clean and warns when there are unsaved edits', () => {
    expect(decideRemoteSave(idle, saved(5))).toBe('reload');
    expect(decideRemoteSave({ ...idle, isDirty: true }, saved(5))).toBe('warn');
  });
});

function Harness({ reload }: { reload: () => Promise<void> }) {
  useRemoteSaveWatch(true, reload);
  return null;
}

describe('an open editor told about a save elsewhere', () => {
  beforeEach(() => {
    useNotebookStore.getState().loadNotebook(doc);
  });
  afterEach(() => vi.restoreAllMocks());

  it('reloads and shows a notice when nothing is unsaved', async () => {
    const reload = vi.fn().mockResolvedValue(undefined);
    render(<Harness reload={reload} />);
    act(() => emit(saved(5, { by: { kind: 'agent', name: 'claude code' } })));
    await waitFor(() =>
      expect(useNotebookStore.getState().remoteNotice).toMatch(/saved by agent claude code just now/)
    );
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload over unsaved edits; it warns instead', () => {
    useNotebookStore.setState({ isDirty: true });
    const reload = vi.fn();
    render(<Harness reload={reload} />);
    act(() => emit(saved(7, { by: { kind: 'user', name: 'alice' } })));
    expect(reload).not.toHaveBeenCalled();
    expect(useNotebookStore.getState().remoteChange).toEqual({ revision: 7, by: 'alice' });
  });

  it('ignores its own save', () => {
    const reload = vi.fn();
    render(<Harness reload={reload} />);
    act(() => emit(saved(4)));
    expect(reload).not.toHaveBeenCalled();
    expect(useNotebookStore.getState().remoteChange).toBeNull();
  });
});

describe('RemoteChangeBanner', () => {
  it('names the revision and offers Reload', () => {
    const onReload = vi.fn().mockResolvedValue(undefined);
    render(
      <RemoteChangeBanner
        change={{ revision: 9, by: 'alice' }}
        notice={null}
        onReload={onReload}
        onDismissNotice={() => {}}
      />
    );
    expect(screen.getByText(/changed elsewhere \(revision 9/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(onReload).toHaveBeenCalled();
  });
});
