import type { CatalogChangedEvent, RunActivityEvent, RunWatchMessage } from '@zaa-tool/shared';
import { WS_BASE_URL } from './api.js';
import { useAuthStore } from '../store/authStore.js';

/**
 * One socket per tab, watching the workspace, shared by everything that needs it.
 *
 * The map opened its own connection, and every screen that wanted to stop being stale was
 * about to open another — four screens, four sockets, four authentications, all asking the
 * engine the same question. This is the one connection, and joining it is refcounted:
 * it opens when the first screen asks and closes when the last one leaves.
 *
 * The part that matters more than the sharing is **reconnection**. A socket dies when a
 * laptop lid closes, when a phone changes network, when nginx restarts — and a dead socket
 * looks exactly like a quiet workspace. Nothing arrives either way. So it comes back with
 * a backoff, and while it is down it *says so*, because a screen silently showing an hour
 * old list is the failure this milestone exists to end.
 *
 * Deliberately not a React hook. The connection outlives any one component, and a hook
 * would tie its lifetime to whichever screen happened to mount first.
 */

export type WatchStatus = 'connecting' | 'live' | 'offline';

/** Backoff between reconnection attempts: doubles, and stops doubling here. */
const FIRST_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;

type Listener<T> = (event: T) => void;

const activityListeners = new Set<Listener<RunActivityEvent>>();
const catalogListeners = new Set<Listener<CatalogChangedEvent>>();
const statusListeners = new Set<Listener<WatchStatus>>();

let socket: WebSocket | null = null;
let members = 0;
let retryMs = FIRST_RETRY_MS;
let retryTimer: number | null = null;
let status: WatchStatus = 'offline';

function announce(next: WatchStatus): void {
  if (status === next) return;
  status = next;
  for (const listener of statusListeners) listener(next);
}

export function watchStatusNow(): WatchStatus {
  return status;
}

function deliver(raw: string): void {
  let parsed: { type?: string };
  try {
    parsed = JSON.parse(raw) as { type?: string };
  } catch {
    return;
  }

  if (parsed.type === 'run:activity') {
    const event = parsed as RunActivityEvent;
    if (!event.notebookId) return;
    for (const listener of activityListeners) listener(event);
    return;
  }

  if (parsed.type === 'catalog:changed') {
    const event = parsed as CatalogChangedEvent;
    if (!event.notebookId) return;
    for (const listener of catalogListeners) listener(event);
  }
}

function connect(): void {
  if (socket || members === 0) return;

  // Nobody signed in means the engine would refuse and close, and retrying that on a
  // backoff is a loop that accomplishes nothing but noise in two logs.
  if (!useAuthStore.getState().user) {
    announce('offline');
    return;
  }

  announce('connecting');
  const opening = new WebSocket(WS_BASE_URL);
  socket = opening;

  opening.onopen = () => {
    // No `auth` message: the session is the cookie that came with the upgrade.
    const message: RunWatchMessage = { action: 'watch' };
    opening.send(JSON.stringify(message));
    // Only after the connection is actually up. Resetting on the *attempt* would turn
    // the backoff into a one-second poll against a server that is down.
    retryMs = FIRST_RETRY_MS;
    announce('live');
  };

  opening.onmessage = (event) => deliver(event.data as string);

  opening.onclose = () => {
    if (socket !== opening) return;
    socket = null;
    announce('offline');
    if (members > 0) retryLater();
  };

  // `onerror` is always followed by `onclose`, so scheduling here as well would give two
  // reconnections for one failure.
  opening.onerror = () => undefined;
}

function retryLater(): void {
  if (retryTimer !== null) return;
  retryTimer = window.setTimeout(() => {
    retryTimer = null;
    connect();
  }, retryMs);
  retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
}

/**
 * Reconnects now rather than waiting out the backoff.
 *
 * For the moment a tab is looked at again: the laptop has been shut for an hour, the
 * backoff is sitting at thirty seconds, and the person is staring at the screen right now.
 */
export function reviveWatch(): void {
  if (socket || members === 0) return;
  if (retryTimer !== null) {
    window.clearTimeout(retryTimer);
    retryTimer = null;
  }
  retryMs = FIRST_RETRY_MS;
  connect();
}

function join(): () => void {
  members += 1;
  connect();

  let left = false;
  return () => {
    if (left) return;
    left = true;
    members -= 1;
    if (members > 0) return;

    if (retryTimer !== null) {
      window.clearTimeout(retryTimer);
      retryTimer = null;
    }
    const closing = socket;
    socket = null;
    closing?.close();
    announce('offline');
  };
}

/** Which notebook is running, anywhere — including runs this browser never started. */
export function watchRunActivity(listener: Listener<RunActivityEvent>): () => void {
  activityListeners.add(listener);
  const leave = join();
  return () => {
    activityListeners.delete(listener);
    leave();
  };
}

/** That the set of notebooks moved: one was saved, deployed, undeployed or deleted. */
export function watchCatalog(listener: Listener<CatalogChangedEvent>): () => void {
  catalogListeners.add(listener);
  const leave = join();
  return () => {
    catalogListeners.delete(listener);
    leave();
  };
}

/**
 * Whether this tab is still being told things.
 *
 * Subscribing to the status does *not* join: a screen that only wants to know whether the
 * connection is up has no business keeping it open.
 */
export function watchConnection(listener: Listener<WatchStatus>): () => void {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}
