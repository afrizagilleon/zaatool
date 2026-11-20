/**
 * FX5 — the contract must not change under someone's hands.
 *
 * Making the Apps list refresh itself created a hazard that did not exist while it was a
 * photograph. The open page used to be a lookup into the list — `pages.find(...)` — so the
 * moment the list refetched, a deploy in another window would rewrite the form somebody
 * was standing in front of: a field they had filled in disappears, a new required one
 * appears empty, and the run they press next is refused for a reason nothing on screen
 * explains.
 *
 * Staying silent is the other half of the same failure. So the page they opened is the
 * page they keep, it says that a newer one exists, and taking it is a button.
 *
 *   pnpm --filter @zaa-tool/web test page-moved
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { NotebookPage } from '@zaa-tool/shared';
import { AppsPage } from '../src/components/pages/AppsPage';
import { notebooksApi } from '../src/lib/notebooks-api';
import { useAuthStore } from '../src/store/authStore';

let sockets: FakeSocket[] = [];

class FakeSocket {
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;

  constructor() {
    sockets.push(this);
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.();
    }, 0);
  }

  send() {}
  close() {
    this.readyState = 3;
    this.onclose?.();
  }

  announce(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

function page(over: Partial<NotebookPage> = {}): NotebookPage {
  return {
    id: 'p1',
    name: 'kurs-usd-idr',
    description: '',
    tags: [],
    notes: [],
    inputs: [{ name: 'amount', type: 'number' }],
    outputs: [],
    layout: [],
    actions: [],
    ...over,
  } as NotebookPage;
}

const OPENED = page();
const REDEPLOYED = page({ inputs: [{ name: 'currency', type: 'string' }] });

beforeEach(() => {
  sockets = [];
  vi.restoreAllMocks();
  vi.stubGlobal('WebSocket', FakeSocket);
  window.localStorage.clear();
  useAuthStore.setState({ user: { id: 'u1', username: 'zz', email: null, role: 'creator' } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

/** Opens the one app in the list and waits for its form. */
async function openTheApp() {
  const user = userEvent.setup();
  render(<AppsPage />);
  await user.click(await screen.findByText('kurs-usd-idr'));
  await screen.findByLabelText(/amount/i);
  await waitFor(() => expect(sockets.length).toBeGreaterThan(0));
  return user;
}

describe('an app that was redeployed while it was open', () => {
  it('keeps the version being used, and says a new one exists', async () => {
    const pages = vi.spyOn(notebooksApi, 'pages').mockResolvedValue([OPENED]);
    const user = await openTheApp();

    pages.mockResolvedValue([REDEPLOYED]);
    sockets[0].announce({ type: 'catalog:changed', change: 'deployed', notebookId: 'p1' });

    expect(await screen.findByRole('status')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('new version');
    // The field they were using is still the field they were using.
    expect(screen.getByLabelText(/amount/i)).toBeTruthy();
    expect(screen.queryByLabelText(/currency/i)).toBeNull();

    // And taking it is their decision, not the deploy's.
    await user.click(screen.getByRole('button', { name: /load it/i }));
    expect(await screen.findByLabelText(/currency/i)).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('says when the app was withdrawn, and offers nothing to load', async () => {
    const pages = vi.spyOn(notebooksApi, 'pages').mockResolvedValue([OPENED]);
    await openTheApp();

    pages.mockResolvedValue([]);
    sockets[0].announce({ type: 'catalog:changed', change: 'undeployed', notebookId: 'p1' });

    const banner = await screen.findByRole('status');
    expect(banner.textContent).toContain('taken out of production');
    expect(screen.queryByRole('button', { name: /load it/i })).toBeNull();
  });

  it('says nothing at all when the deploy was of some other notebook', async () => {
    // A workspace where an agent is working is a workspace announcing changes constantly.
    // A banner on every one of them is a banner nobody reads.
    const pages = vi.spyOn(notebooksApi, 'pages').mockResolvedValue([OPENED]);
    await openTheApp();

    pages.mockResolvedValue([OPENED, page({ id: 'p2', name: 'something-else' })]);
    sockets[0].announce({ type: 'catalog:changed', change: 'deployed', notebookId: 'p2' });

    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
