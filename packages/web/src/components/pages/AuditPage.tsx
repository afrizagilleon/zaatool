import { useState } from 'react';
import { ClipboardText, DownloadSimple, ArrowClockwise } from '@phosphor-icons/react';
import { useUiStore } from '../../store/uiStore.js';
import { useAuthStore } from '../../store/authStore.js';
import { useAuditTrail } from '../../hooks/useAuditTrail.js';
import {
  ACTOR_TYPES,
  OUTCOMES,
  auditExportUrl,
  describeActor,
  type AuditEvent,
  type AuditFilters,
} from '../../lib/audit-api.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

const OUTCOME_CLASS: Record<AuditEvent['outcome'], string> = {
  success: 'text-emerald-500',
  failure: 'text-destructive',
  denied: 'text-amber-500',
};

const selectClass =
  'h-8 block rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring';

/**
 * Who did what, and to what. Open to everyone signed in: the engine decides which events a
 * person may see (a creator sees all; anyone else sees what they did or what happened to
 * their own notebooks), so the page does not filter and cannot widen it.
 */
export function AuditPage() {
  const activeTab = useUiStore((s) => s.activeTab);
  const isCreator = useAuthStore((s) => s.user?.role) === 'creator';

  // What is typed, and what is applied: filtering on every keystroke would be a request
  // per letter against a table that grows without bound.
  const [draft, setDraft] = useState<AuditFilters>({});
  const [applied, setApplied] = useState<AuditFilters>({});
  const { events, hasMore, isLoading, error, loadMore, refresh } = useAuditTrail(applied);

  if (activeTab !== 'audit') return null;

  const set = (key: keyof AuditFilters, value: string) => setDraft((d) => ({ ...d, [key]: value }));

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-6xl mx-auto w-full p-6 space-y-4">
        <div className="flex items-center gap-2">
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <ClipboardText className="text-primary" /> Audit trail
          </h1>
          <div className="flex-1" />
          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => void refresh()}>
            <ArrowClockwise size={13} /> Refresh
          </Button>
          {isCreator && (
            <Button asChild size="sm" variant="outline" className="h-8 gap-1.5 text-xs">
              <a href={auditExportUrl(applied)} download="audit.jsonl">
                <DownloadSimple size={13} /> Export JSONL
              </a>
            </Button>
          )}
        </div>

        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setApplied({ ...draft });
          }}
        >
          <label className="space-y-1 text-[11px] text-muted-foreground">
            Action starts with
            <Input
              value={draft.action ?? ''}
              onChange={(e) => set('action', e.target.value)}
              placeholder="notebook."
              className="h-8 w-44 text-xs font-mono"
            />
          </label>
          <label className="space-y-1 text-[11px] text-muted-foreground block">
            Actor
            <select className={selectClass} value={draft.actorType ?? ''} onChange={(e) => set('actorType', e.target.value)}>
              <option value="">Any</option>
              {ACTOR_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-[11px] text-muted-foreground block">
            Outcome
            <select className={selectClass} value={draft.outcome ?? ''} onChange={(e) => set('outcome', e.target.value)}>
              <option value="">Any</option>
              {OUTCOMES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-[11px] text-muted-foreground">
            Target id
            <Input
              value={draft.targetId ?? ''}
              onChange={(e) => set('targetId', e.target.value)}
              placeholder="notebook id"
              className="h-8 w-56 text-xs font-mono"
            />
          </label>
          <Button type="submit" size="sm" className="h-8 text-xs">
            Apply
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 text-xs"
            onClick={() => {
              setDraft({});
              setApplied({});
            }}
          >
            Clear
          </Button>
        </form>

        {error && (
          <div
            role="alert"
            className="p-3 rounded-md bg-destructive/10 text-destructive text-sm font-medium border border-destructive/20"
            data-testid="audit-error"
          >
            {error}
          </div>
        )}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Outcome</TableHead>
              <TableHead>Target</TableHead>
              <TableHead>IP</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.map((event) => {
              const actor = describeActor(event.actor);
              return (
                <TableRow key={event.id} data-testid="audit-row">
                  <TableCell className="whitespace-nowrap" title={event.at}>
                    {new Date(event.at).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <span className="inline-block rounded border border-border px-1.5 py-0.5 text-[10px] uppercase mr-1.5">
                      {actor.type}
                    </span>
                    <span className="font-medium">{actor.name}</span>
                    {actor.detail && <div className="text-[10px] text-muted-foreground">{actor.detail}</div>}
                  </TableCell>
                  <TableCell className="font-mono">{event.action}</TableCell>
                  <TableCell className={`font-semibold ${OUTCOME_CLASS[event.outcome] ?? ''}`}>
                    {event.outcome}
                  </TableCell>
                  <TableCell>
                    <span className="text-muted-foreground">{event.target.type}</span>{' '}
                    <span title={event.target.id ?? undefined}>
                      {event.target.name ?? event.target.id?.slice(0, 8) ?? ''}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-muted-foreground">{event.ip ?? ''}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        {!isLoading && !error && events.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground" data-testid="audit-empty">
            No events match. Events appear here as people and agents work.
          </p>
        )}
        {isLoading && <p className="py-2 text-center text-xs text-muted-foreground">Loading...</p>}
        {hasMore && !isLoading && (
          <div className="flex justify-center">
            <Button size="sm" variant="outline" className="text-xs" onClick={() => void loadMore()}>
              Load more
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
