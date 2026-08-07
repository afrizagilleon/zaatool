import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AccountUser } from '@zaa-tool/shared';
import { AccountsTab } from '../src/components/resources/AccountsTab';
import { useAuthStore } from '../src/store/authStore';

const mockUsers: AccountUser[] = [
  {
    id: 'u1',
    username: 'creator-user',
    email: 'creator@example.com',
    role: 'creator',
    active: true,
    createdAt: '2026-08-01T00:00:00Z',
  },
  {
    id: 'u2',
    username: 'viewer-user',
    email: null,
    role: 'viewer',
    active: true,
    createdAt: '2026-08-02T00:00:00Z',
  },
  {
    id: 'u3',
    username: 'inactive-user',
    email: 'inactive@example.com',
    role: 'viewer',
    active: false,
    createdAt: '2026-08-03T00:00:00Z',
  },
];

describe('AccountsTab component', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: { id: 'u1', username: 'creator-user', email: 'creator@example.com', role: 'creator' },
      token: 'mock-token',
    });
  });

  it('renders list of accounts with roles and status badges (T-07)', () => {
    render(<AccountsTab accounts={mockUsers} onCreate={async () => true} />);

    expect(screen.getByText('creator-user')).toBeDefined();
    expect(screen.getByText('viewer-user')).toBeDefined();
    expect(screen.getByText('inactive-user')).toBeDefined();
    expect(screen.getByText('creator@example.com')).toBeDefined();
    expect(screen.getAllByText('Active')).toHaveLength(2);
    expect(screen.getByText('Inactive')).toBeDefined();
  });

  it('does NOT display deactivate button on current signed in user row (T-08)', () => {
    const handleSetActive = vi.fn().mockResolvedValue(true);
    render(
      <AccountsTab
        accounts={mockUsers}
        onCreate={async () => true}
        onSetActive={handleSetActive}
      />
    );

    // Current user u1 should not have Deactivate button. Only u2 should have Deactivate.
    const deactivateButtons = screen.getAllByRole('button', { name: /Deactivate/i });
    expect(deactivateButtons).toHaveLength(1);

    // Activate button for u3 (exact match so it does not match Deactivate)
    const activateButtons = screen.getAllByRole('button', { name: /^Activate$/i });
    expect(activateButtons).toHaveLength(1);
  });

  it('calls onSetActive when deactivate/activate button is clicked (T-08)', async () => {
    const handleSetActive = vi.fn().mockResolvedValue(true);
    const user = userEvent.setup();

    render(
      <AccountsTab
        accounts={mockUsers}
        onCreate={async () => true}
        onSetActive={handleSetActive}
      />
    );

    const deactivateBtn = screen.getByRole('button', { name: /Deactivate/i });
    await user.click(deactivateBtn);
    expect(handleSetActive).toHaveBeenLastCalledWith('u2', false);

    const activateBtn = screen.getByRole('button', { name: /^Activate$/i });
    await user.click(activateBtn);
    expect(handleSetActive).toHaveBeenLastCalledWith('u3', true);
  });
});
