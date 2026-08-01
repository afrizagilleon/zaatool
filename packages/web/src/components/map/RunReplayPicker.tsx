import { useEffect, useState } from 'react';
import { ClockCounterClockwise } from '@phosphor-icons/react';
import type { NotebookRunSummary } from '@zaa-tool/shared';
import { notebooksApi } from '../../lib/notebooks-api';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';

/**
 * Which run the map is showing.
 *
 * `live` is the present — cells light up as they execute. Anything else is the past:
 * the same drawing, with what actually happened laid over it. That is the view for
 * "the 6am cron failed, where?", which otherwise means scrolling a long document in
 * the editor looking for a red cell.
 */

const LIVE = 'live';

function label(run: NotebookRunSummary): string {
  const started = new Date(run.started_at);
  const clock = started.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const day = started.toLocaleDateString([], { day: '2-digit', month: 'short' });
  const outcome = run.status === 'failed' ? 'failed' : run.status === 'running' ? 'running' : 'ok';
  const cause = run.trigger_source === 'call' ? ' · called' : run.trigger_source === 'cron' ? ' · cron' : '';
  return `${day} ${clock} · ${outcome}${cause}`;
}

interface RunReplayPickerProps {
  notebookId: string;
  value: string | undefined;
  onChange: (runId: string | undefined) => void;
  /** Changing this refetches — a run that just finished should appear. */
  refreshKey: unknown;
}

export function RunReplayPicker({ notebookId, value, onChange, refreshKey }: RunReplayPickerProps) {
  const [runs, setRuns] = useState<NotebookRunSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    notebooksApi
      .listRuns(notebookId)
      .then((loaded) => !cancelled && setRuns(loaded))
      .catch(() => !cancelled && setRuns([]));
    return () => {
      cancelled = true;
    };
  }, [notebookId, refreshKey]);

  if (runs.length === 0) return null;

  return (
    <Select
      value={value ?? LIVE}
      onValueChange={(next) => onChange(next === LIVE ? undefined : next)}
    >
      <SelectTrigger className="h-6 w-[200px] text-[11px] px-2 gap-1.5">
        <ClockCounterClockwise size={12} className="shrink-0 text-muted-foreground" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={LIVE} className="text-[11px]">
          Live
        </SelectItem>
        {runs.map((run) => (
          <SelectItem key={run.id} value={run.id} className="text-[11px]">
            {label(run)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
