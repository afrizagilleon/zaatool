/**
 * FX5 — deploy in one place, and the other place knows.
 *
 * Every list in this app was a photograph of the moment it opened. `useEffect(..., [])`,
 * fetch once, and from then on the only way to learn that anything had changed was to
 * press reload — which meant deploying a notebook and then wondering, on the Apps screen,
 * whether the deploy had failed.
 *
 * The engine could already say so: the watch channel has existed since M7.4 and the
 * catalogue announcement since the MCP work. Neither end was connected to the other. What
 * is checked here is that connection, and the part of it that is easy to get wrong — that
 * an update arriving on its own does **not** throw the list back into its loading state,
 * because the rows on screen are still true and blanking them is a worse lie than being
 * a second stale.
 *
 *   pnpm --filter @zaa-tool/web test list-refresh
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { NotebookSummary } from '@zaa-tool/shared';
import { NotebookList } from '../src/components/notebook/NotebookList';
import { notebooksApi } from '../src/lib/notebooks-api';
import { useAuthStore } from '../src/store/authStore';

let sockets: FakeSocket[] = [];

/** Enough of a socket to be accepted, dropped and spoken through on cue. */
class FakeSocket {
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;

  constructor() {
    sockets.push(this);
    // Accepted on the next tick, the way a real one is — never inside the render that
    // created it.
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

function summary(over: Partial<NotebookSummary> & { id: string; name: string }): NotebookSummary {
  return {
    runtime: 'node',
    created_at: '2026-08-06T00:00:00.000Z',
    updated_at: '2026-08-06T00:00:00.000Z',
    deployed: false,
    last_run_at: null,
    last_run_status: null,
    trigger_kinds: [],
    tags: [],
    ...over,
  };
}

const FIRST = [summary({ id: 'n1', name: 'daily-exchange-monitor' })];
const AFTER = [
  summary({ id: 'n1', name: 'daily-exchange-monitor' }),
  summary({ id: 'n2', name: 'kurs-usd-idr' }),
];

beforeEach(() => {
  sockets = [];
  vi.restoreAllMocks();
  vi.stubGlobal('WebSocket', FakeSocket);
  window.localStorage.clear();
  // Without a signed-in user the socket is deliberately never opened, so there would be nothing
  // to test.
  useAuthStore.setState({ user: { id: 'u1', username: 'zz', email: null, role: 'creator' } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('a list that is told', () => {
  it('shows a notebook that appeared somewhere else, without a reload', async () => {
    const list = vi.spyOn(notebooksApi, 'list').mockResolvedValue(FIRST);
    render(<NotebookList onOpen={vi.fn()} onCreate={vi.fn()} />);
    await screen.findByText('daily-exchange-monitor');

    list.mockResolvedValue(AFTER);
    await waitFor(() => expect(sockets).toHaveLength(1));
    sockets[0].announce({ type: 'catalog:changed', change: 'saved', notebookId: 'n2' });

    expect(await screen.findByText('kurs-usd-idr')).toBeTruthy();
  });

  it('does not empty the screen while it fetches', async () => {
    // The rows on screen are still true. A spinner here would be the app throwing away
    // something correct in order to display something identical.
    const list = vi.spyOn(notebooksApi, 'list').mockResolvedValue(FIRST);
    render(<NotebookList onOpen={vi.fn()} onCreate={vi.fn()} />);
    await screen.findByText('daily-exchange-monitor');

    let release: (rows: NotebookSummary[]) => void = () => {};
    list.mockReturnValue(new Promise((resolve) => (release = resolve)));

    await waitFor(() => expect(sockets).toHaveLength(1));
    sockets[0].announce({ type: 'catalog:changed', change: 'saved', notebookId: 'n2' });

    // Mid-flight, and the old row is still there.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(screen.getByText('daily-exchange-monitor')).toBeTruthy();
    release(AFTER);
  });

  it('ignores an announcement about a run, which is a different question', async () => {
    const list = vi.spyOn(notebooksApi, 'list').mockResolvedValue(FIRST);
    render(<NotebookList onOpen={vi.fn()} onCreate={vi.fn()} />);
    await screen.findByText('daily-exchange-monitor');
    await waitFor(() => expect(sockets).toHaveLength(1));

    sockets[0].announce({ type: 'run:activity', runId: 'r1', notebookId: 'n1', status: 'running' });
    await new Promise((resolve) => setTimeout(resolve, 300));

    // A cron firing every minute must not become a list request every minute.
    expect(list).toHaveBeenCalledTimes(1);
  });
});

describe('a list that has stopped being told', () => {
  it('says so rather than looking the same as a quiet workspace', async () => {
    vi.spyOn(notebooksApi, 'list').mockResolvedValue(FIRST);
    render(<NotebookList onOpen={vi.fn()} onCreate={vi.fn()} />);
    await screen.findByText('daily-exchange-monitor');
    await waitFor(() => expect(sockets).toHaveLength(1));

    // Nothing on screen while it is up: a permanent "connected" banner is furniture, and
    // furniture is what people stop reading before the one time it matters.
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());

    sockets[0].close();
    expect(await screen.findByRole('status')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Not live');
  });

  it('fetches again when it comes back, because the gap is unknowable', async () => {
    // Whatever happened while the socket was down was not announced to anyone. The only
    // honest response to a hole is to ask again — and it costs one request when the hole
    // turns out to have been empty.
    const list = vi.spyOn(notebooksApi, 'list').mockResolvedValue(FIRST);
    render(<NotebookList onOpen={vi.fn()} onCreate={vi.fn()} />);
    await screen.findByText('daily-exchange-monitor');
    await waitFor(() => expect(sockets).toHaveLength(1));
    // Opening is not a gap: mounting already fetched, and counting the socket coming up
    // as well would have every screen ask for its list twice.
    expect(list).toHaveBeenCalledTimes(1);

    sockets[0].close();
    list.mockResolvedValue(AFTER);
    await waitFor(() => expect(sockets).toHaveLength(2), { timeout: 3_000 });

    expect(await screen.findByText('kurs-usd-idr')).toBeTruthy();
  });
});
