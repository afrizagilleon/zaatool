import { useEffect, useState } from 'react';
import { API_BASE_URL } from '../../lib/api';

/**
 * Which build is running, on both sides.
 *
 * It sits here rather than anywhere prettier because this is the page you are already on
 * when something is wrong. The question after every deploy is the same — *is the thing
 * running what I just pushed* — and the honest answers are two, not one: the bundle in
 * this browser is stamped at build time, and the engine answers for itself.
 *
 * Showing both is the point. They disagree exactly when someone's browser is holding an
 * old bundle, which is the most common confusing state after an update and the one that
 * otherwise looks like a bug in the app.
 */

interface EngineBuild {
  version: string;
  commit: string;
  startedAt: string;
}

/** Baked by the Dockerfile; `dev` when running from a working copy. */
const WEB_VERSION = import.meta.env.VITE_BUILD_VERSION ?? 'dev';
const WEB_COMMIT = import.meta.env.VITE_BUILD_COMMIT ?? 'unknown';

function short(commit: string): string {
  return commit === 'unknown' ? commit : commit.slice(0, 7);
}

export function BuildVersion() {
  const [engine, setEngine] = useState<EngineBuild | null>(null);
  const [unreachable, setUnreachable] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/health`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('unreachable'))))
      .then(setEngine)
      .catch(() => setUnreachable(true));
  }, []);

  const mismatched = engine !== null && engine.commit !== WEB_COMMIT;

  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-3 text-[11px] text-muted-foreground">
      <span>
        app <code className="font-mono">{WEB_VERSION}</code>
        <span className="text-muted-foreground/60"> · {short(WEB_COMMIT)}</span>
      </span>

      {unreachable ? (
        <span className="text-status-error">the engine is not answering</span>
      ) : engine ? (
        <>
          <span>
            engine <code className="font-mono">{engine.version}</code>
            <span className="text-muted-foreground/60"> · {short(engine.commit)}</span>
          </span>
          <span className="text-muted-foreground/60">
            up since {new Date(engine.startedAt).toLocaleString()}
          </span>
          {mismatched && (
            <span className="text-amber-500">
              these are different builds — reload with a hard refresh
            </span>
          )}
        </>
      ) : null}
    </div>
  );
}
