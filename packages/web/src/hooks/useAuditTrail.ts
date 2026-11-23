import { useCallback, useEffect, useRef, useState } from 'react';
import { auditApi, type AuditEvent, type AuditFilters } from '../lib/audit-api.js';

/**
 * The audit trail for one set of filters, newest first, read a page at a time.
 *
 * Changing the filters starts over; a response that arrives for filters that are no longer
 * the current ones is dropped, so a slow answer to an old filter cannot replace a new one.
 */
export function useAuditTrail(filters: AuditFilters) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  const key = JSON.stringify(filters);

  const load = useCallback(
    async (before: string | null) => {
      const mine = ++generation.current;
      setIsLoading(true);
      setError(null);
      try {
        const page = await auditApi.list(JSON.parse(key) as AuditFilters, before);
        if (mine !== generation.current) return;
        setEvents((prev) => (before ? [...prev, ...page.events] : page.events));
        setNext(page.next);
      } catch (err: unknown) {
        if (mine !== generation.current) return;
        setError((err as Error).message);
      } finally {
        if (mine === generation.current) setIsLoading(false);
      }
    },
    [key]
  );

  useEffect(() => {
    // Fetching on mount and when the filters change is what this effect is for; the state it
    // sets is the loading flag of that fetch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(null);
  }, [load]);

  return {
    events,
    hasMore: next !== null,
    isLoading,
    error,
    loadMore: () => (next ? load(next) : Promise.resolve()),
    refresh: () => load(null),
  };
}
