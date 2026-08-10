import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { NotebookCell } from '../src/components/notebook/NotebookCell';

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
        cell={cell}
        index={0}
        runtime="node"
        collapsed={{ note: false, code: false, output: false }}
        onUpdate={() => {}}
        onRemove={() => {}}
        onMove={() => {}}
        onRun={() => {}}
      />
    );

    const copyBtn = getByTitle('Copy cell ID');
    expect(copyBtn).not.toBeNull();

    fireEvent.click(copyBtn);
    expect(writeTextMock).toHaveBeenCalledWith('cell-zz-12345');
  });
});
