import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { NotebookCell } from '../src/components/notebook/NotebookCell';

const defaultProps = {
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

describe('NotebookCell copy cell id (T-03)', () => {
  it('copies cell id to clipboard when copy button is clicked', () => {
    const cell = {
      id: 'cell-zz-12345',
      kind: 'cell' as const,
      code: 'return { x: 1 };',
    };

    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    const { getByTitle } = render(
      <NotebookCell
        {...defaultProps}
        cell={cell}
        index={0}
        runtime="node"
      />
    );

    const copyBtn = getByTitle('Copy cell ID');
    expect(copyBtn).not.toBeNull();

    fireEvent.click(copyBtn);
    expect(writeTextMock).toHaveBeenCalledWith('cell-zz-12345');
  });
});

// T-06 ("run until this cell") was removed in review rather than shipped. The button
// existed and this test passed, but nothing ever passed `onRunUntil`, so the control
// never appeared in the editor — and it could not have worked if it had: the run API
// takes one `cellId` or nothing, with no way to ask for a range. See §10 of the
// contract; the capability needs its own milestone, starting in the engine.

describe('NotebookCell writes indicator and duplicate write warning (T-07)', () => {
  it('renders writes badge when cell writes outputs', () => {
    const cell = {
      id: 'cell-zz-outputs',
      kind: 'cell' as const,
      code: 'return { total: 100, report: "ok" };',
    };

    const { getByTestId } = render(
      <NotebookCell
        {...defaultProps}
        cell={cell}
        index={0}
        runtime="node"
        writes={['total', 'report']}
      />
    );

    const badge = getByTestId('cell-writes-badge');
    expect(badge).not.toBeNull();
    expect(badge.textContent).toContain('writes: total, report');
  });

  it('renders duplicate write warning badge when hasDuplicateWrites is true', () => {
    const cell = {
      id: 'cell-zz-dup',
      kind: 'cell' as const,
      code: 'return { total: 200 };',
    };

    const { getByTestId } = render(
      <NotebookCell
        {...defaultProps}
        cell={cell}
        index={1}
        runtime="node"
        writes={['total']}
        hasDuplicateWrites={true}
      />
    );

    const warning = getByTestId('duplicate-write-warning');
    expect(warning).not.toBeNull();
    expect(warning.textContent).toContain('Duplicate write');
  });
});
