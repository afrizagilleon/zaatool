import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NotebookToolbar } from '../src/components/notebook/NotebookToolbar';

describe('NotebookToolbar uv indicator (T-05)', () => {
  const defaultProps = {
    name: 'zz-test',
    secrets: [],
    packages: [],
    tags: [],
    isDirty: false,
    isSaving: false,
    isRunning: false,
    staleCount: 0,
    triggerCount: 0,
    contractShape: { inputs: 0, outputs: 0 },
    isPreviewing: false,
    onTogglePreview: vi.fn(),
    allCollapsed: { note: false, code: false, output: false },
    onToggleAllSections: vi.fn(),
    onNameChange: vi.fn(),
    onRuntimeChange: vi.fn(),
    onSecretsChange: vi.fn(),
    onPackagesChange: vi.fn(),
    onTagsChange: vi.fn(),
    onSave: vi.fn(),
    onRun: vi.fn(),
    onBack: vi.fn(),
  };

  it('renders uv badge when runtime is python and packages are declared', () => {
    render(<NotebookToolbar {...defaultProps} runtime="python" packages={['pandas']} />);
    const uvBadges = screen.getAllByTestId('uv-indicator');
    expect(uvBadges.length).toBeGreaterThan(0);
    expect(uvBadges[0].textContent).toBe('uv');
  });

  it('does not render uv badge when runtime is python with no packages, or when runtime is node', () => {
    render(<NotebookToolbar {...defaultProps} runtime="python" packages={[]} />);
    expect(screen.queryByTestId('uv-indicator')).toBeNull();

    render(<NotebookToolbar {...defaultProps} runtime="node" packages={['express']} />);
    expect(screen.queryByTestId('uv-indicator')).toBeNull();
  });
});
