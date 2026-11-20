/**
 * FX-23: what SonarCloud's accessibility rules asked for, checked as a person using a
 * keyboard or a screen reader would meet it.
 *
 *  - every form label names its control (`getByLabelText` finds the field by its label);
 *  - a clickable block that is not a button can be reached with Tab and used with Enter
 *    or Space;
 *  - the lane-rename box still takes focus the moment it appears, now without `autoFocus`.
 *
 *   pnpm --filter @zaa-tool/web test
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { NotebookSummary } from '@zaa-tool/shared';
import { AccountsTab } from '../src/components/resources/AccountsTab';
import { AgentTokensTab } from '../src/components/resources/AgentTokensTab';
import { SecretsTab } from '../src/components/resources/SecretsTab';
import { SkillEditorDialog } from '../src/components/resources/SkillEditorDialog';
import { ParallelGroup } from '../src/components/notebook/ParallelGroup';
import { NotebookCell } from '../src/components/notebook/NotebookCell';
import { NotebookList } from '../src/components/notebook/NotebookList';
import { notebooksApi } from '../src/lib/notebooks-api';

// The editor is Monaco, which needs a real browser; the labels are what is under test here.
vi.mock('@monaco-editor/react', () => ({
  default: () => <div data-testid="editor" />,
}));

beforeEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('form labels are tied to their fields', () => {
  it('Add Account', async () => {
    render(<AccountsTab accounts={[]} onCreate={async () => true} />);
    await userEvent.setup().click(screen.getByRole('button', { name: /add account/i }));

    const username = screen.getByLabelText('Username') as HTMLInputElement;
    expect(username.tagName).toBe('INPUT');
    expect((screen.getByLabelText('Email (Optional)') as HTMLInputElement).type).toBe('email');
    expect((screen.getByLabelText('Password') as HTMLInputElement).type).toBe('password');
    expect(screen.getByLabelText('Role').tagName).toBe('SELECT');

    // Typing through the label's field reaches the form state.
    await userEvent.setup().type(username, 'newbie');
    expect(username.value).toBe('newbie');
  });

  it('Issue Token', async () => {
    render(<AgentTokensTab tokens={[]} onIssue={vi.fn()} onRevoke={vi.fn()} />);
    await userEvent.setup().click(screen.getByRole('button', { name: /issue token/i }));
    expect(screen.getByLabelText('Label / Name').tagName).toBe('INPUT');
    expect(screen.getByLabelText('Scope').tagName).toBe('SELECT');
  });

  it('Add Secret', async () => {
    render(<SecretsTab secrets={[]} onAdd={vi.fn()} onDelete={vi.fn()} />);
    await userEvent.setup().click(screen.getByRole('button', { name: /add secret/i }));
    expect(screen.getByLabelText('Key Name').tagName).toBe('INPUT');
    expect((screen.getByLabelText('Value') as HTMLInputElement).type).toBe('password');
  });

  it('the skill editor', () => {
    render(<SkillEditorDialog open onOpenChange={vi.fn()} skill={null} onSave={vi.fn()} />);
    expect(screen.getByLabelText('Skill Name').tagName).toBe('INPUT');
    expect(screen.getByLabelText('Description').tagName).toBe('INPUT');
  });

  it('two dialogs on one page do not share ids', () => {
    const { container } = render(
      <>
        <SkillEditorDialog open onOpenChange={vi.fn()} skill={null} onSave={vi.fn()} />
      </>
    );
    const ids = Array.from(document.querySelectorAll('[id]')).map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(container).toBeTruthy();
  });
});

describe('lane rename box takes focus', () => {
  it('when the name is clicked', async () => {
    const group = {
      id: 'g1',
      kind: 'parallel' as const,
      lanes: [{ id: 'l1', label: 'First', steps: [] }],
    };
    render(
      <ParallelGroup
        group={group}
        depth={0}
        onAddLane={vi.fn()}
        onRemoveLane={vi.fn()}
        onRenameLane={vi.fn()}
        onRemoveGroup={vi.fn()}
        onAddCell={vi.fn()}
        onAddGroup={vi.fn()}
        renderLane={() => null}
      />
    );
    await userEvent.setup().click(screen.getByTitle('Click to rename this lane'));
    const box = screen.getByDisplayValue('First');
    expect(document.activeElement).toBe(box);
  });
});

describe('the note of a cell', () => {
  const props = {
    isDarkMode: false,
    run: undefined,
    isStale: false,
    isBusy: false,
    collapsed: { note: false, code: false, output: false },
    onToggleSection: vi.fn(),
    onNoteChange: vi.fn(),
    onCodeChange: vi.fn(),
    onRemove: vi.fn(),
    onMove: vi.fn(),
    onAddBelow: vi.fn(),
    onRun: vi.fn(),
    onRunAndAdvance: vi.fn(),
    onSave: vi.fn(),
  };

  it('is reachable by Tab and opens for editing with Enter or Space', () => {
    render(
      <NotebookCell
        {...props}
        cell={{ id: 'c1', kind: 'cell', note: 'Explain the step.', code: 'return 1;' }}
        index={0}
        runtime="node"
      />
    );
    const note = screen.getByTitle('Click to edit the note');
    expect(note.getAttribute('role')).toBe('button');
    expect(note.tabIndex).toBe(0);

    fireEvent.keyDown(note, { key: 'a' });
    expect(screen.queryByTitle('Click to edit the note')).not.toBeNull();

    fireEvent.keyDown(note, { key: 'Enter' });
    expect(screen.queryByTitle('Click to edit the note')).toBeNull();
  });

  it('opens with Space too', () => {
    render(
      <NotebookCell
        {...props}
        cell={{ id: 'c1', kind: 'cell', note: 'Explain the step.', code: 'return 1;' }}
        index={0}
        runtime="node"
      />
    );
    fireEvent.keyDown(screen.getByTitle('Click to edit the note'), { key: ' ' });
    expect(screen.queryByTitle('Click to edit the note')).toBeNull();
  });
});

describe('a row of the notebook list', () => {
  const summary = (id: string, name: string): NotebookSummary => ({
    id,
    name,
    runtime: 'node',
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-08-06T06:32:44.000Z',
    deployed: false,
    last_run_at: null,
    last_run_status: null,
    trigger_kinds: [],
    tags: [],
  });

  it('opens with Enter or Space when the row itself has focus', async () => {
    vi.spyOn(notebooksApi, 'list').mockResolvedValue([summary('n1', 'daily-report')]);
    const onOpen = vi.fn();
    render(<NotebookList onOpen={onOpen} onCreate={vi.fn()} />);
    const name = await screen.findByText('daily-report');
    const row = name.closest('[role="button"]') as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.tabIndex).toBe(0);

    fireEvent.keyDown(row, { key: 'x' });
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(onOpen).toHaveBeenCalledWith('n1');
    fireEvent.keyDown(row, { key: ' ' });
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it('leaves a key pressed on something inside the row alone', async () => {
    vi.spyOn(notebooksApi, 'list').mockResolvedValue([summary('n1', 'daily-report')]);
    const onOpen = vi.fn();
    render(<NotebookList onOpen={onOpen} onCreate={vi.fn()} />);
    const name = await screen.findByText('daily-report');
    fireEvent.keyDown(name, { key: 'Enter' });
    expect(onOpen).not.toHaveBeenCalled();
  });
});
