import { useEffect, useState } from 'react';
import { API_BASE_URL } from './api';

/**
 * The time zone the engine reads every cron expression in (its `CRON_TZ`).
 *
 * Taken from the policy endpoint the login page already uses, because it is public and
 * already says what this deployment does. Fetched once per page load; until it arrives, or
 * if it never does, nothing is shown rather than a guess.
 */
let pending: Promise<string | null> | null = null;

function load(): Promise<string | null> {
  pending ??= fetch(`${API_BASE_URL}/api/auth/policy`)
    .then((res) => (res.ok ? res.json() : null))
    .then((data: { cronTimezone?: unknown } | null) =>
      typeof data?.cronTimezone === 'string' ? data.cronTimezone : null
    )
    .catch(() => null);
  return pending;
}

export function useCronTimezone(): string | null {
  const [zone, setZone] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void load().then((value) => {
      if (live) setZone(value);
    });
    return () => {
      live = false;
    };
  }, []);

  return zone;
}
