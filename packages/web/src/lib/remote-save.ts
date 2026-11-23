import type { CatalogChangedEvent } from '@zaa-tool/shared';

/** What the editor knows that decides how a save made elsewhere is treated. */
export interface EditorSnapshot {
  id: string;
  revision: number | null;
  isDirty: boolean;
  isSaving: boolean;
}

export type RemoteSaveAction = 'ignore' | 'reload' | 'warn';

/**
 * What an open editor should do when the engine announces that a notebook was saved.
 *
 * Only a revision newer than the editor's own counts, which is what makes the editor's own
 * saves invisible here: its revision is already the one the announcement carries. An
 * announcement without a revision (an older engine) is ignored rather than guessed at.
 * While a save of its own is in flight the answer is also `ignore`: the announcement can
 * arrive before the save's response does, and reloading then would throw away the response.
 *
 * With nothing unsaved there is nothing to lose, so the copy is simply refreshed; with
 * unsaved edits the person is told and decides, because a reload would delete them.
 */
export function decideRemoteSave(editor: EditorSnapshot, event: CatalogChangedEvent): RemoteSaveAction {
  if (event.change !== 'saved' || event.notebookId !== editor.id) return 'ignore';
  if (typeof event.revision !== 'number') return 'ignore';
  if (editor.revision === null || event.revision <= editor.revision) return 'ignore';
  if (editor.isSaving) return 'ignore';
  return editor.isDirty ? 'warn' : 'reload';
}

/** "Updated: saved by Alice just now" / "...by an agent (claude code)..." */
export function describeSaver(by: CatalogChangedEvent['by']): string {
  if (!by) return 'someone else';
  return by.kind === 'agent' ? `agent ${by.name}` : by.name;
}
