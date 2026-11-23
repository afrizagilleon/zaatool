import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { AuditPage } from '../src/components/pages/AuditPage';
import { useUiStore } from '../src/store/uiStore';
import { useAuthStore } from '../src/store/authStore';
import { describeActor, type AuditEvent } from '../src/lib/audit-api';

const event = (n: number, over: Partial<AuditEvent> = {}): AuditEvent => ({
  id: String(n),
  at: '2026-11-23T10:00:00.000Z',
  action: 'notebook.deploy',
  outcome: 'success',
  actor: { type: 'agent', label: 'claude code', client: 'claude-ai/1.0', token_id: 'abcdef123456' },
  target: { type: 'notebook', id: 'nb-1', ownerId: 'u1', name: 'Report' },
  ip: '10.0.0.5',
  userAgent: null,
  requestId: null,
  meta: {},
  ...over,
});

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

describe('AuditPage', () => {
  beforeEach(() => {
    useUiStore.setState({ activeTab: 'audit' });
    useAuthStore.setState({ user: { id: 'u1', username: 'amy', role: 'creator' } as never });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('lists events with actor, action, outcome, target and ip, with the ISO time as tooltip', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({ events: [event(2)], next: null })));
    render(<AuditPage />);
    expect(await screen.findByText('claude code')).toBeTruthy();
    expect(screen.getByText(/claude-ai\/1.0 · token abcdef12/)).toBeTruthy();
    expect(screen.getByText('notebook.deploy')).toBeTruthy();
    expect(within(screen.getByTestId('audit-row')).getByText('success')).toBeTruthy();
    expect(screen.getByText('Report')).toBeTruthy();
    expect(screen.getByText('10.0.0.5')).toBeTruthy();
    expect(screen.getByTitle('2026-11-23T10:00:00.000Z')).toBeTruthy();
  });

  it('loads the next page with the cursor and applies filters from the first page', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok({ events: [event(2)], next: '2' }))
      .mockResolvedValueOnce(ok({ events: [event(1)], next: null }))
      .mockResolvedValue(ok({ events: [], next: null }));
    vi.stubGlobal('fetch', fetchMock);
    render(<AuditPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(screen.getAllByTestId('audit-row')).toHaveLength(2));
    expect(String(fetchMock.mock.calls[1][0])).toContain('before=2');

    fireEvent.change(screen.getByPlaceholderText('notebook.'), { target: { value: 'secret.' } });
    fireEvent.change(screen.getByLabelText('Outcome'), { target: { value: 'denied' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => {
      const last = String(fetchMock.mock.calls.at(-1)![0]);
      expect(last).toContain('action=secret.');
      expect(last).toContain('outcome=denied');
      expect(last).not.toContain('before=');
    });
    expect(await screen.findByTestId('audit-empty')).toBeTruthy();
  });

  it('shows the export to creators only, with the filters in the link', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({ events: [], next: null })));
    const { unmount } = render(<AuditPage />);
    const link = (await screen.findByText('Export JSONL')).closest('a');
    expect(link?.getAttribute('href')).toContain('/api/audit/export?format=jsonl');
    unmount();

    useAuthStore.setState({ user: { id: 'u2', username: 'bo', role: 'viewer' } as never });
    render(<AuditPage />);
    await screen.findByTestId('audit-empty');
    expect(screen.queryByText('Export JSONL')).toBeNull();
  });

  it('shows the reason the engine gave when loading fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: 'Sign in again.' }) })
    );
    render(<AuditPage />);
    expect((await screen.findByTestId('audit-error')).textContent).toContain('Sign in again.');
  });
});

describe('describeActor', () => {
  it('reads each kind of actor', () => {
    expect(describeActor({ type: 'user', username: 'amy' }).name).toBe('amy');
    expect(describeActor({ type: 'cron', trigger_id: '1234567890' }).name).toBe('trigger 12345678');
    expect(describeActor({ type: 'cli', command: 'create-user', os_user: 'root' })).toMatchObject({
      name: 'create-user',
      detail: 'root',
    });
  });
});
