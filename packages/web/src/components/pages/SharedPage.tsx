import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { Play, Spinner, Lock, WarningCircle, CircleDashed } from '@phosphor-icons/react';
import type { NotebookPage } from '@zaa-tool/shared';
import { API_BASE_URL } from '../../lib/api';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { InputField, initialValues, toArgs } from './render/InputField';
import { CopyTileValueButton } from './render/CopyTileValueButton';
import { tileTitle } from '../../lib/tile-title';

import { OutputView } from './render/OutputView';

import { NotesBlock } from './render/NotesBlock';

import { PageGrid } from './render/PageGrid';
import { PageActions } from './render/PageActions';
import { authenticateSocket, connectRunSocket, subscribeToRun } from '../../lib/run-socket';
import { cn } from '../../lib/utils';

/**
 * A page opened by someone who has no account here.
 *
 * Rendered before the login gate, from the same components the signed-in page uses —
 * a shared page that looked different would be a second page to keep in step. What
 * differs is only what is absent: no navigation, no editing, no arranging.
 *
 * The token in the URL is the credential. A password, if the owner set one, is typed
 * once and kept in memory for the tab; it is sent with each request rather than
 * exchanged for a session, because a session is machinery this does not need.
 */

type OutputStatus = 'waiting' | 'running' | 'ready' | 'failed';

interface CellEvent {
  type?: string;
  cellId?: string;
  written?: string[];
  output?: Record<string, unknown>;
  error?: string;
}

function Pending({ status }: { status: OutputStatus }) {
  if (status === 'failed') {
    return (
      <span className="flex items-center gap-1.5 text-xs text-status-error">
        <WarningCircle size={13} weight="fill" />
        Failed
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground/70">
      {status === 'running' ? (
        <>
          <Spinner size={13} className="animate-spin" />
          Working…
        </>
      ) : (
        <>
          <CircleDashed size={13} />
          Waiting
        </>
      )}
    </span>
  );
}

export function SharedPage({ token }: { token: string }) {
  const [page, setPage] = useState<NotebookPage | null>(null);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [values, setValues] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Record<string, OutputStatus>>({});
  const [outputs, setOutputs] = useState<Record<string, unknown>>({});
  const [runId, setRunId] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  /**
   * A shared page belongs to whoever opened the link, not to whoever deployed it.
   *
   * `uiStore` keeps the operator's light/dark choice in `localStorage` per origin and
   * writes it onto `<html>` the moment the module loads — before this component gets a
   * say, and regardless of route. That is right for the app and wrong here: a page handed
   * to somebody with no account has no "app preference" to inherit, and inheriting one
   * meant a stranger's first visit was dark because *you* had chosen dark once, on a
   * screen they have never seen.
   *
   * Read once, at mount, in a layout effect so it lands before the first paint. Not
   * subscribed to changes: this exists to break an inheritance, not to build the theme
   * switcher the share page deliberately does not have.
   */
  useLayoutEffect(() => {
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ?? false;
    document.documentElement.classList.toggle('dark', prefersDark);
  }, []);

  const headers = useCallback(
    (): Record<string, string> => ({
      'Content-Type': 'application/json',
      ...(password ? { 'X-Share-Password': password } : {}),
    }),
    [password]
  );

  const load = useCallback(
    async (withPassword: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${API_BASE_URL}/api/shared/${token}`, {
          headers: {
            'Content-Type': 'application/json',
            ...(withPassword ? { 'X-Share-Password': withPassword } : {}),
          },
        });
        const body = await res.json().catch(() => ({}));

        if (res.status === 401 && body.needsPassword) {
          setNeedsPassword(true);
          // Only an error once something was actually typed; the first ask is not a
          // failure, it is the door.
          if (withPassword) setError('That password does not work.');
          setPage(null);
          return;
        }
        if (!res.ok) {
          setError(body.error ?? 'This link does not work.');
          setPage(null);
          return;
        }

        setNeedsPassword(false);
        setPage(body as NotebookPage);
        setValues(initialValues((body as NotebookPage).inputs));
      } catch (err: unknown) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [token]
  );

  useEffect(() => {
    void load('');
  }, [load]);

  const run = async () => {
    if (!page) return;
    setIsRunning(true);
    setError(null);
    setStatus(Object.fromEntries(page.outputs.map((output) => [output.name, 'waiting'])));

    try {
      const res = await fetch(`${API_BASE_URL}/api/shared/${token}/run`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ args: toArgs(page.inputs, values) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? 'It could not run.');
        setIsRunning(false);
        return;
      }
      setRunId(body.runId as string);
    } catch (err: unknown) {
      setError((err as Error).message);
      setIsRunning(false);
    }
  };

  useEffect(() => {
    if (!runId || !page) return;
    const names = page.outputs.map((output) => output.name);

    const socket = connectRunSocket(
      (message) => {
        let event: CellEvent;
        try {
          event = JSON.parse(message.data as string) as CellEvent;
        } catch {
          return;
        }

        if (event.type === 'cell:done') {
          for (const name of event.written ?? []) {
            if (!names.includes(name)) continue;
            setStatus((current) => ({ ...current, [name]: 'ready' }));
            setOutputs((current) => ({ ...current, [name]: event.output?.[name] }));
          }
          return;
        }

        if (event.type === 'run:done' || event.type === 'run:error') {
          setStatus((current) => {
            const next = { ...current };
            for (const name of names) {
              if (next[name] === 'ready') continue;
              next[name] = event.type === 'run:error' ? 'failed' : 'ready';
            }
            return next;
          });
          if (event.type === 'run:error') setError(event.error ?? 'The run failed.');
          setIsRunning(false);
        }
      },
      () => {},
      () => {}
    );

    socket.onopen = () => {
      // The link is the credential here too — the same token the page was fetched with.
      authenticateSocket(socket, token);
      subscribeToRun(socket, runId);
    };
    return () => {
      socket.onclose = null;
      socket.close();
    };
  }, [runId, page]);

  if (needsPassword) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
        <form
          className="w-full max-w-xs space-y-3 border border-border p-6"
          onSubmit={(event) => {
            event.preventDefault();
            void load(password);
          }}
        >
          <div className="flex items-center gap-2">
            <Lock size={15} className="text-muted-foreground" />
            <h1 className="text-sm font-bold">This page is protected</h1>
          </div>
          <Input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password"
            className="h-8 text-xs"
            autoFocus
          />
          {error && <p className="text-[11px] text-status-error">{error}</p>}
          <Button type="submit" size="sm" className="h-8 w-full text-xs">
            Open
          </Button>
        </form>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
        <Spinner size={18} className="animate-spin" />
      </div>
    );
  }

  if (!page) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
        <div className="max-w-sm space-y-2 border border-border p-6 text-center">
          <WarningCircle size={20} className="mx-auto text-muted-foreground" />
          <p className="text-sm">{error ?? 'This link does not work.'}</p>
        </div>
      </div>
    );
  }

  const hasResult = Object.keys(status).length > 0;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
        <div>
          <h1 className="text-xl font-bold tracking-tight">{page.name}</h1>
          {page.description && (
            <p className="mt-1 text-sm text-muted-foreground">{page.description}</p>
          )}
        </div>

        <NotesBlock notes={page.notes} />


        {page.inputs.length > 0 && (
          <div className="space-y-4 border border-border p-4">
            {page.inputs.map((input) => (
              <InputField
                key={input.name}
                input={input}
                value={values[input.name] ?? ''}
                onChange={(next) => setValues((current) => ({ ...current, [input.name]: next }))}
                notebookId={page.id}
                // No account here, so the link is what authorises an attachment too.
                shareToken={token}
              />
            ))}
          </div>
        )}

        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-start">
          <Button onClick={() => void run()} disabled={isRunning} className="h-9 px-5 sm:shrink-0">
            {isRunning ? (
              <Spinner size={15} className="mr-2 animate-spin" />
            ) : (
              <Play size={15} weight="fill" className="mr-2" />
            )}
            Run
          </Button>
          {/* No `onRun`: the server strips every `run` action from a shared page, so
              there is nothing here that could reach another notebook. */}
          <PageActions actions={page.actions} disabled={isRunning} onRerun={() => void run()} />
        </div>

        {error && (
          <div className="border border-status-error/40 bg-status-error/5 p-3 text-xs text-status-error">
            {error}
          </div>
        )}

        {hasResult && (
          <PageGrid
            outputs={page.outputs}
            layout={page.layout.length > 0 ? page.layout : undefined}
            renderTile={(output) => {
              const state = status[output.name] ?? 'waiting';
              const hasValue = output.name in outputs;

              return (
                <>
                  <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-1.5">
                    <span className="min-w-0 truncate text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      {tileTitle(output)}
                    </span>
                    <div className="flex-1" />
                    {hasValue && <CopyTileValueButton value={outputs[output.name]} />}
                    {state === 'running' && (

                      <Spinner size={10} className="animate-spin text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-auto p-3">
                    {output.description && (
                      <p className="text-[11px] text-muted-foreground/70">{output.description}</p>
                    )}
                    {hasValue ? (
                      <div className={cn('min-h-0 flex-1', state !== 'ready' && 'opacity-40')}>
                        <OutputView output={output} value={outputs[output.name]} />
                      </div>
                    ) : (
                      <Pending status={state} />
                    )}
                  </div>
                </>
              );
            }}
          />
        )}
      </div>
    </div>
  );
}
