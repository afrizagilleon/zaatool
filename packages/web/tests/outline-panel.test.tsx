import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OutlinePanel } from '../src/components/notebook/OutlinePanel';
import type { NotebookStep } from '@zaa-tool/shared';

describe('OutlinePanel (T-04: view, search, fold per lane)', () => {
  const steps: NotebookStep[] = [
    {
      id: 'cell-1',
      kind: 'cell',
      note: '# Fetch data',
      code: 'const rows = await fetch("/data").then(r => r.json());',
    },
    {
      id: 'parallel-1',
      kind: 'parallel',
      lanes: [
        {
          id: 'lane-a',
          label: 'Branch A',
          steps: [
            {
              id: 'cell-2',
              kind: 'cell',
              note: '# Process A',
              code: 'return { totalA: 100 };',
            },
          ],
        },
        {
          id: 'lane-b',
          label: 'Branch B',
          steps: [
            {
              id: 'cell-3',
              kind: 'cell',
              note: '# Process B',
              code: 'return { totalB: 200 };',
            },
          ],
        },
      ],
    },
  ];

  it('renders all cells in the outline panel', () => {
    render(<OutlinePanel steps={steps} />);

    expect(screen.getByText('Fetch data')).toBeTruthy();
    expect(screen.getByText('Process A')).toBeTruthy();
    expect(screen.getByText('Process B')).toBeTruthy();
    expect(screen.getByText('Branch A')).toBeTruthy();
    expect(screen.getByText('Branch B')).toBeTruthy();
  });

  it('filters cells based on search input', () => {
    render(<OutlinePanel steps={steps} />);

    const searchInput = screen.getByPlaceholderText(/search cells/i);
    fireEvent.change(searchInput, { target: { value: 'totalA' } });

    expect(screen.queryByText('Fetch data')).toBeNull();
    expect(screen.getByText('Process A')).toBeTruthy();
    expect(screen.queryByText('Process B')).toBeNull();
  });

  it('triggers fold lane callback when fold button is clicked', () => {
    const handleFoldLane = vi.fn();
    render(<OutlinePanel steps={steps} onFoldLane={handleFoldLane} />);

    const foldBtn = screen.getByRole('button', { name: /Fold Branch A/i });
    expect(foldBtn).toBeTruthy();

    fireEvent.click(foldBtn);
    expect(handleFoldLane).toHaveBeenCalledWith('lane-a', true);
  });
});
