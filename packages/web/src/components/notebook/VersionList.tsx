import { useCallback, useEffect, useState } from 'react';
import { RocketLaunch, Spinner, WarningCircle } from '@phosphor-icons/react';
import type { NotebookJson, NotebookTrigger, NotebookVersionSummary } from '@zaa-tool/shared';
import { Button } from '../ui/button';
import { notebooksApi } from '../../lib/notebooks-api';
import { diffNotebooks } from '../../lib/notebook-diff';

interface VersionListProps {
  notebookId: string;
  open: boolean;
  onChanged: () => void;
}

interface ProductionSnapshot {
  versions: NotebookVersionSummary[];
  current: NotebookJson | null;
}

function enabledTriggers(document: NotebookJson): NotebookTrigger[] {
  return (document.triggers ?? []).filter((trigger) => trigger.enabled !== false);
}

function triggerLabel(trigger: NotebookTrigger): string {
  return trigger.kind === 'cron' ? trigger.cron : `/hooks/${trigger.slug}`;
}

function triggerKey(trigger: NotebookTrigger): string {
  return `${trigger.kind}:${triggerLabel(trigger)}`;
}

function TriggerChanges({ current, target }: { current: NotebookJson | null; target: NotebookJson }) {
  const before = new Map((current ? enabledTriggers(current) : []).map((trigger) => [triggerKey(trigger), trigger]));
  const after = new Map(enabledTriggers(target).map((trigger) => [triggerKey(trigger), trigger]));
  const starting = [...after.values()].filter((trigger) => !before.has(triggerKey(trigger)));
  const stopping = [...before.values()].filter((trigger) => !after.has(triggerKey(trigger)));

  if (starting.length === 0 && stopping.length === 0) {
    return <p className="text-[11px] text-muted-foreground">No triggers switch on or off.</p>;
  }
  return (
    <ul className="space-y-1 text-[11px]">
      {starting.map((trigger) => (
        <li key={`start-${triggerKey(trigger)}`}>
          <span className="font-semibold text-status-done">Starts:</span> {trigger.kind}{' '}
          <code className="font-mono break-all">{triggerLabel(trigger)}</code>
        </li>
      ))}
      {stopping.map((trigger) => (
        <li key={`stop-${triggerKey(trigger)}`}>
          <span className="font-semibold text-status-error">Stops:</span> {trigger.kind}{' '}
          <code className="font-mono break-all">{triggerLabel(trigger)}</code>
        </li>
      ))}
    </ul>
  );
}

function RollbackReview({ current, target }: { current: NotebookJson | null; target: NotebookJson }) {
  // The same behavioural diff as an ordinary deploy: production is the "before" and the
  // historical document is the "after". Copying that comparison here would let the two
  // decisions drift apart.
  const diff = current ? diffNotebooks(current, target) : null;

  return (
    <div className="space-y-3 border border-border p-3">
      {!current && (
        <p className="text-[11px] text-muted-foreground">
          Nothing is deployed now. Confirming starts production with this version.
        </p>
      )}
      {current && current.name !== target.name && (
        <p className="text-[11px] text-amber-600 dark:text-amber-500">
          The production name changes from <strong>{current.name}</strong> to{' '}
          <strong>{target.name}</strong>. Calls to <code>notebooks.run(&quot;{target.name}&quot;)</code>{' '}
          will follow that deployed name.
        </p>
      )}

      <section className="space-y-1.5">
        <h4 className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
          Trigger changes
        </h4>
        <TriggerChanges current={current} target={target} />
      </section>

      {diff?.isEmpty && (
        <p className="text-[11px] text-muted-foreground">This document matches current production.</p>
      )}

      {diff && diff.settings.length > 0 && (
        <section className="space-y-1.5">
          <h4 className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
            Settings
          </h4>
          {diff.settings.map((change) => (
            <div key={change.what} className="grid gap-1 text-[10px] sm:grid-cols-[5rem_1fr]">
              <span className="font-semibold">{change.what}</span>
              <span className="min-w-0 font-mono break-words">
                <span className="text-status-error line-through opacity-70">{change.before}</span>
                {' → '}
                <span className="text-status-done">{change.after}</span>
              </span>
            </div>
          ))}
        </section>
      )}

      {diff && diff.cells.length > 0 && (
        <section className="space-y-1.5">
          <h4 className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
            Cells ({diff.cells.length})
          </h4>
          {diff.cells.map((change) => (
            <div key={change.cellId} className="border border-border/60 p-2">
              <div className="mb-1 text-[10px]">
                <span className="mr-2 font-semibold uppercase">{change.kind}</span>
                <span>{change.label}</span>
              </div>
              {change.before !== undefined && (
                <pre className="mb-1 max-h-32 overflow-auto whitespace-pre-wrap break-words bg-status-error/5 p-2 font-mono text-[10px] opacity-70">
                  {change.before || '(empty)'}
                </pre>
              )}
              {change.after !== undefined && (
                <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words bg-status-done/5 p-2 font-mono text-[10px]">
                  {change.after || '(empty)'}
                </pre>
              )}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

/** Deployment history and the informed confirmation for pinning an old document anew. */
export function VersionList({ notebookId, open, onChanged }: VersionListProps) {
  const [versions, setVersions] = useState<NotebookVersionSummary[] | null>(null);
  const [current, setCurrent] = useState<NotebookJson | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [target, setTarget] = useState<NotebookJson | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isReading, setIsReading] = useState(false);
  const [isWorking, setIsWorking] = useState(false);

  const [previousOpen, setPreviousOpen] = useState(open);
  if (open !== previousOpen) {
    setPreviousOpen(open);
    if (open) {
      setVersions(null);
      setCurrent(null);
      setSelectedId(null);
      setTarget(null);
      setError(null);
    }
  }

  const readProduction = useCallback(async (): Promise<ProductionSnapshot> => {
    const listed = await notebooksApi.listVersions(notebookId);
    const deployed = listed.some((version) => version.isCurrent)
      ? await notebooksApi.deployedDocument(notebookId)
      : null;
    return { versions: listed, current: deployed };
  }, [notebookId]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    readProduction()
      .then((snapshot) => {
        if (cancelled) return;
        setVersions(snapshot.versions);
        setCurrent(snapshot.current);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setVersions([]);
        setError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [open, readProduction]);

  const select = async (versionId: string) => {
    setSelectedId(versionId);
    setTarget(null);
    setIsReading(true);
    setError(null);
    try {
      setTarget(await notebooksApi.getVersion(notebookId, versionId));
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setIsReading(false);
    }
  };

  const rollback = async () => {
    if (!selectedId || !target) return;
    setIsWorking(true);
    setError(null);
    try {
      await notebooksApi.redeployVersion(notebookId, selectedId);
      onChanged();
      setVersions(null);
      setSelectedId(null);
      setTarget(null);
      const snapshot = await readProduction();
      setVersions(snapshot.versions);
      setCurrent(snapshot.current);
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setIsWorking(false);
    }
  };

  const selected = versions?.find((version) => version.id === selectedId) ?? null;

  return (
    <section className="space-y-3 border-t border-border pt-3">
      <div>
        <h3 className="text-xs font-semibold">Version history</h3>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Rolling back deploys a new copy of the old version. Your draft will not change.
        </p>
      </div>

      {versions === null && <p className="text-[11px] text-muted-foreground">Loading versions…</p>}
      {versions?.length === 0 && !error && (
        <p className="text-[11px] text-muted-foreground">No versions have been deployed yet.</p>
      )}

      <div className="max-h-56 space-y-1 overflow-y-auto">
        {versions?.map((version) => (
          <button
            key={version.id}
            type="button"
            aria-label={`Review v${version.number}`}
            disabled={version.isCurrent || isReading || isWorking}
            onClick={() => void select(version.id)}
            className="w-full border border-border/60 px-3 py-2 text-left hover:bg-muted/40 disabled:cursor-default disabled:opacity-70"
          >
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-semibold">v{version.number}</span>
              <span className="text-[11px]">{version.name}</span>
              {version.isCurrent && (
                <span className="bg-status-done/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-status-done">
                  Active
                </span>
              )}
              {version.sourceNumber !== null && (
                <span className="text-[10px] text-muted-foreground">Rollback from v{version.sourceNumber}</span>
              )}
            </span>
            <span className="mt-1 block text-[10px] text-muted-foreground">
              {new Date(version.createdAt).toLocaleString()}
              {version.deployedBy ? ` · ${version.deployedBy}` : ''}
            </span>
          </button>
        ))}
      </div>

      {isReading && <p className="text-[11px] text-muted-foreground">Loading the selected version…</p>}
      {selected && target && (
        <div className="space-y-3">
          <h4 className="text-xs font-semibold">Make v{selected.number} production?</h4>
          <RollbackReview current={current} target={target} />
          {(target.secrets?.length ?? 0) > 0 && (
            <p className="border border-amber-500/40 p-2 text-[11px] text-amber-600 dark:text-amber-500">
              Production will use your secrets: <code>{target.secrets?.join(', ')}</code>.
            </p>
          )}
          <p className="text-[11px] text-muted-foreground">
            This creates v{(versions?.length ?? selected.number) + 1}. Your draft will not change.
          </p>
          <Button size="sm" className="h-8 w-full text-xs sm:w-auto" disabled={isWorking} onClick={() => void rollback()}>
            {isWorking ? <Spinner size={12} className="mr-1.5 animate-spin" /> : <RocketLaunch size={12} className="mr-1.5" />}
            Make v{selected.number} production
          </Button>
        </div>
      )}

      {error && (
        <p className="flex items-start gap-1.5 text-xs text-status-error" role="alert">
          <WarningCircle size={13} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}
    </section>
  );
}
