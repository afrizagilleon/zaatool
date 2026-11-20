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

describe('Navbar profile dialog (T-09 & T-10)', () => {
  it('shows hidden tabs explanation for viewer role, but not for creator role (T-09)', async () => {
    const { Navbar } = await import('../src/components/layout/Navbar');
    const user = userEvent.setup();

    // 1. Viewer role
    useAuthStore.setState({
      user: { id: 'u2', username: 'viewer-user', email: null, role: 'viewer' },
    });

    const { unmount } = render(<Navbar />);
    const profileBtn = screen.getAllByTitle('viewer-user — view profile')[0];
    await user.click(profileBtn);

    const explanation = screen.getByTestId('viewer-explanation');
    expect(explanation).toBeDefined();
    expect(explanation.textContent).toContain('Notebooks, Resources');
    unmount();

    // 2. Creator role
    useAuthStore.setState({
      user: { id: 'u1', username: 'creator-user', email: 'creator@example.com', role: 'creator' },
    });

    render(<Navbar />);
    const creatorBtn = screen.getAllByTitle('creator-user — view profile')[0];
    await user.click(creatorBtn);

    expect(screen.queryByTestId('viewer-explanation')).toBeNull();
  });

  it('submits change password form in profile dialog (T-10)', async () => {
    const { Navbar } = await import('../src/components/layout/Navbar');
    const user = userEvent.setup();

    const changePasswordMock = vi.fn().mockResolvedValue(true);
    useAuthStore.setState({
      user: { id: 'u1', username: 'creator-user', email: 'creator@example.com', role: 'creator' },
      changePassword: changePasswordMock,
    });

    render(<Navbar />);
    const profileBtn = screen.getAllByTitle('creator-user — view profile')[0];
    await user.click(profileBtn);


    const currentPwdInput = screen.getByPlaceholderText('Current password');
    const newPwdInput = screen.getByPlaceholderText('New password (min 8 chars)');
    const submitBtn = screen.getByRole('button', { name: /Update Password/i });

    await user.type(currentPwdInput, 'oldpass123');
    await user.type(newPwdInput, 'newpass123');
    await user.click(submitBtn);

    expect(changePasswordMock).toHaveBeenCalledWith('oldpass123', 'newpass123');
  });

  it('displays 403 error message as readable text in DOM (T-12)', () => {
    const errorMsg = 'This needs a creator account. Yours is viewer.';
    render(
      <AccountsTab
        accounts={mockUsers}
        error={errorMsg}
        onCreate={async () => false}
      />
    );

    const errorElement = screen.getByTestId('accounts-error');
    expect(errorElement).toBeDefined();
    expect(errorElement.textContent).toBe(errorMsg);
  });
});


