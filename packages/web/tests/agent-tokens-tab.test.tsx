import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AgentTokensTab } from '../src/components/resources/AgentTokensTab';
import type { AgentTokenRecord } from '../src/hooks/useAgentTokens';

describe('AgentTokensTab (T-06)', () => {
  const dummyTokens: AgentTokenRecord[] = [
    {
      id: 'tok-1',
      label: 'Hermes Agent',
      scope: 'author',
      created_at: new Date().toISOString(),
      last_used_at: null,
    },
    {
      id: 'tok-2',
      label: 'Reader Bot',
      scope: 'reader',
      created_at: new Date().toISOString(),
      last_used_at: new Date().toISOString(),
    },
  ];

  it('renders list of agent tokens and handles issue/revoke callbacks', async () => {
    const onIssue = vi.fn().mockResolvedValue('zaa_mock_secret_token_123456');
    const onRevoke = vi.fn().mockResolvedValue(true);

    render(
      <AgentTokensTab
        tokens={dummyTokens}
        onIssue={onIssue}
        onRevoke={onRevoke}
      />
    );

    // 1. Renders token labels in table
    expect(screen.getByText('Hermes Agent')).toBeInTheDocument();
    expect(screen.getByText('Reader Bot')).toBeInTheDocument();

    // 2. Click Issue Token button to open dialog
    const openBtn = screen.getByRole('button', { name: /issue token/i });
    fireEvent.click(openBtn);

    // 3. Fill form and submit
    const labelInput = screen.getByPlaceholderText(/hermes bot/i);
    fireEvent.change(labelInput, { target: { value: 'New Test Token' } });

    const submitBtns = screen.getAllByRole('button', { name: /issue token/i });
    const dialogSubmitBtn = submitBtns[submitBtns.length - 1];
    fireEvent.click(dialogSubmitBtn);

    await waitFor(() => {
      expect(onIssue).toHaveBeenCalledWith('New Test Token', 'author');
    });

    // 4. Test newlyIssuedToken banner if passed
    const { rerender } = render(
      <AgentTokensTab
        tokens={dummyTokens}
        newlyIssuedToken="zaa_mock_secret_token_123456"
        onIssue={onIssue}
        onRevoke={onRevoke}
      />
    );

    expect(screen.getByText('zaa_mock_secret_token_123456')).toBeInTheDocument();
    expect(screen.getByText(/save this token now/i)).toBeInTheDocument();

    // 5. Test revoke button
    const revokeBtns = screen.getAllByRole('button', { name: /revoke/i });
    fireEvent.click(revokeBtns[0]);

    await waitFor(() => {
      expect(onRevoke).toHaveBeenCalledWith('tok-1');
    });
  });
});
