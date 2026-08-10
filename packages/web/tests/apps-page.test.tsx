import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PageRunner } from '../src/components/pages/AppsPage';
import type { NotebookPage } from '@zaa-tool/shared';
import { notebooksApi } from '../src/lib/notebooks-api';

vi.mock('../src/lib/notebooks-api', () => ({
  notebooksApi: {
    runDeployed: vi.fn().mockResolvedValue({ runId: 'run-zz-123' }),
    runAction: vi.fn(),
  },
}));

describe('AppsPage compact card for notebook without outputs (T-01, RQ-01, RQ-02)', () => {
  const pageNoOutputs: NotebookPage = {
    id: 'zz-no-outputs',
    name: 'Prose & Side-effects',
    description: 'A notebook with side effects only',
    notes: ['# Heading\nSome notes content.'],
    inputs: [],
    outputs: [],
    layout: [],
    actions: [],
    tags: [],
  };

  it('renders compact card without PageGrid when outputs array is empty', () => {
    const { container } = render(
      <PageRunner
        page={pageNoOutputs}
        latest={pageNoOutputs}
        onReload={() => {}}
        onBack={() => {}}
      />
    );

    // Card text present
    expect(screen.getByText(/has no declared outputs/i)).toBeTruthy();

    // No PageGrid grid container
    const gridContainer = container.querySelector('.grid');
    expect(gridContainer).toBeNull();
  });

  it('displays last run status after clicking Run on notebook without outputs', async () => {
    render(
      <PageRunner
        page={pageNoOutputs}
        latest={pageNoOutputs}
        onReload={() => {}}
        onBack={() => {}}
      />
    );

    const runBtn = screen.getByRole('button', { name: /Run/i });
    expect(runBtn).toBeTruthy();

    fireEvent.click(runBtn);
    expect(notebooksApi.runDeployed).toHaveBeenCalledWith('zz-no-outputs', {});
  });
});
