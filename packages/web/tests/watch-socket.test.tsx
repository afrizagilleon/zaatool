/**
 * FX5 — the connection that has to survive being lost.
 *
 * A screen that updates itself is only worth having if it is honest when it stops. A
 * socket dies when a lid closes, when a phone changes network, when nginx restarts — and
 * from inside the page a dead socket is indistinguishable from a quiet workspace. Nothing
 * arrives either way. That is the failure mode being tested here: not "does an event get
 * through", which is easy, but "what happens when they stop".
 *
 * The `WebSocket` here is a stand-in, because jsdom has none and because a real one cannot
 * be made to fail on cue. Everything it fakes is transport; every rule being checked —
 * refcounting, backoff, the status edge — is this module's own.
 *
 *   pnpm --filter @zaa-tool/web test watch-socket
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Every socket this test made, so it can be opened, closed and inspected on demand. */
let sockets: FakeSocket[] = [];

class FakeSocket {
  static OPEN = 1;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;

  url: string;

  constructor(url: string) {
    this.url = url;
    sockets.push(this);
  }

  send(raw: string) {
    this.sent.push(raw);
  }

  close() {
    this.readyState = 3;
    this.onclose?.();
  }

  /** The engine accepting the connection. */
  accept() {
    this.readyState = 1;
    this.onopen?.();
  }

  /** The engine, or the network, going away without being asked. */
  drop() {
    this.readyState = 3;
    this.onclose?.();
  }

  deliver(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

// A fresh module per test: this is a module-level singleton on purpose — one connection
// per tab — which means its state would otherwise leak from one check into the next.
async function load() {
  vi.resetModules();
  return import('../src/lib/watch-socket');
}

beforeEach(() => {
  sockets = [];
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', FakeSocket);
  window.localStorage.setItem('zaatool_token', 'zz-token');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('one connection, however many screens', () => {
  it('opens once for two subscribers and closes when the last leaves', async () => {
    const watch = await load();
    const leaveOne = watch.watchCatalog(vi.fn());
    const leaveTwo = watch.watchRunActivity(vi.fn());

    // Four screens wanting the same channel used to mean four sockets and four
    // authentications, all asking the engine the same question.
    expect(sockets).toHaveLength(1);

    leaveOne();
    expect(sockets[0].readyState).not.toBe(3);
    leaveTwo();
    expect(sockets[0].readyState).toBe(3);
  });

  it('says who it is before it asks for anything', async () => {
    const watch = await load();
    watch.watchCatalog(vi.fn());
    sockets[0].accept();

    const actions = sockets[0].sent.map((raw) => JSON.parse(raw).action);
    expect(actions).toEqual(['auth', 'watch']);
  });

  it('does not connect at all when nobody is signed in', async () => {
    // The engine would refuse and close, and retrying that on a backoff is a loop whose
    // only product is noise in two logs.
    window.localStorage.removeItem('zaatool_token');
    const watch = await load();
    watch.watchCatalog(vi.fn());

    expect(sockets).toHaveLength(0);
    expect(watch.watchStatusNow()).toBe('offline');
  });
});

describe('what arrives reaches the right listener', () => {
  it('separates a run starting from a notebook changing', async () => {
    const watch = await load();
    const activity = vi.fn();
    const catalog = vi.fn();
    watch.watchRunActivity(activity);
    watch.watchCatalog(catalog);
    sockets[0].accept();

    sockets[0].deliver({ type: 'run:activity', runId: 'r1', notebookId: 'n1', status: 'running' });
    sockets[0].deliver({ type: 'catalog:changed', change: 'deployed', notebookId: 'n1' });

    expect(activity).toHaveBeenCalledTimes(1);
    expect(catalog).toHaveBeenCalledWith({
      type: 'catalog:changed',
      change: 'deployed',
      notebookId: 'n1',
    });
  });

  it('ignores anything it cannot read rather than throwing into the socket', async () => {
    const watch = await load();
    const catalog = vi.fn();
    watch.watchCatalog(catalog);
    sockets[0].accept();

    expect(() => sockets[0].onmessage?.({ data: 'not json' })).not.toThrow();
    sockets[0].deliver({ type: 'run:denied', reason: 'nope' });
    expect(catalog).not.toHaveBeenCalled();
  });
});

describe('losing the connection', () => {
  it('comes back, and backs off rather than hammering', async () => {
    const watch = await load();
    watch.watchCatalog(vi.fn());
    sockets[0].accept();
    sockets[0].drop();

    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(999);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);

    // Still down: the next wait is twice as long, not the same again.
    sockets[1].drop();
    vi.advanceTimersByTime(1_000);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(1_000);
    expect(sockets).toHaveLength(3);
  });

  it('says it is offline while it is, and live again when it is', async () => {
    // The whole point. A list that has quietly been an hour stale is worse than one that
    // admits it cannot say.
    const watch = await load();
    const seen: string[] = [];
    watch.watchConnection((status) => seen.push(status));
    watch.watchCatalog(vi.fn());

    sockets[0].accept();
    sockets[0].drop();
    vi.advanceTimersByTime(1_000);
    sockets[1].accept();

    expect(seen).toEqual(['connecting', 'live', 'offline', 'connecting', 'live']);
  });

  it('starts the wait over once a connection actually holds', async () => {
    const watch = await load();
    watch.watchCatalog(vi.fn());

    sockets[0].accept();
    sockets[0].drop();
    vi.advanceTimersByTime(1_000);
    sockets[1].accept();
    sockets[1].drop();

    // One second again, not two. Resetting on the *attempt* instead would have turned
    // the backoff into a one-second poll against a server that is down.
    vi.advanceTimersByTime(1_000);
    expect(sockets).toHaveLength(3);
  });

  it('reconnects immediately when asked, rather than waiting out the backoff', async () => {
    const watch = await load();
    watch.watchCatalog(vi.fn());
    sockets[0].accept();
    sockets[0].drop();
    vi.advanceTimersByTime(1_000);
    sockets[1].drop();

    // A tab looked at again after an hour: the backoff is long and the person is here now.
    watch.reviveWatch();
    expect(sockets).toHaveLength(3);
  });

  it('does not reconnect after the last screen let go', async () => {
    const watch = await load();
    const leave = watch.watchCatalog(vi.fn());
    sockets[0].accept();
    leave();

    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
  });
});
