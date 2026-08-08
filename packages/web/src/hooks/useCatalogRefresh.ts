import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { reviveWatch, watchCatalog, watchConnection, watchStatusNow } from '../lib/watch-socket.js';

/**
 * Tells a screen when its copy of the catalogue may have stopped being true.
 *
 * Three things can mean that, and they are one job rather than three:
 *
 *  - **A change was announced.** The ordinary case, and the fast one.
 *  - **The tab was looked at again.** Covers everything that happened while the socket was
 *    down, and everything on a phone, where a backgrounded tab is frozen rather than
 *    listening.
 *  - **The socket came back.** A reconnection is an admission that there is a gap, and the
 *    only honest response to a gap is to fetch again.
 *
 * Returns whether the connection is up, so a screen can say when it is *not* — a list that
 * has quietly been stale for an hour is worse than one that admits it.
 */
export function useCatalogRefresh(reload: () => void): boolean {
  const [live, setLive] = useState(() => watchStatusNow() === 'live');
  // Held in a ref so a screen may pass a fresh closure on every render — which every
  // screen does — without tearing down the subscription each time.
  const latest = useRef(reload);
  useLayoutEffect(() => {
    latest.current = reload;
  });

  useEffect(() => {
    // A burst is one refetch. An agent writing four notebooks in a second is four
    // announcements, and four identical list requests would be the reason someone turns
    // this off.
    let pending: number | null = null;
    const soon = () => {
      if (pending !== null) return;
      pending = window.setTimeout(() => {
        pending = null;
        latest.current();
      }, 250);
    };

    const stopWatching = watchCatalog(soon);

    let wasLive = watchStatusNow() === 'live';
    // The first connection is not a gap. Mounting fetches, and the socket coming up a
    // moment later is that same arrival — counting it would make every screen ask for its
    // list twice on open, which is the sort of thing that gets a feature blamed for being
    // slow.
    let everLive = wasLive;

    const stopListening = watchConnection((status) => {
      const nowLive = status === 'live';
      setLive(nowLive);
      // Only on the edge back *up*, and only after it had been up. A reconnection is an
      // admission that there is a hole in what this screen was told.
      if (nowLive && !wasLive && everLive) soon();
      if (nowLive) everLive = true;
      wasLive = nowLive;
    });

    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      reviveWatch();
      soon();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      if (pending !== null) window.clearTimeout(pending);
      document.removeEventListener('visibilitychange', onVisible);
      stopListening();
      stopWatching();
    };
  }, []);

  return live;
}
