import { Handle, Position } from '@xyflow/react';
import type { Node, NodeProps } from '@xyflow/react';
import {
  Clock,
  Globe,
  Warning,
  Question,
  ArrowsSplit,
  ArrowSquareOut,
} from '@phosphor-icons/react';
import { cn } from '../../lib/utils';
import type {
  CallOutNodeData,
  CellNodeData,
  NotebookNodeData,
  TriggerNodeData,
  UnresolvedNodeData,
} from '../../lib/map-graph';

/**
 * The map's three kinds of box.
 *
 * Presentational only — no fetching, no store. What they show comes from the derived
 * map, so a box on screen is a fact about the notebooks rather than something someone
 * once drew and forgot to update.
 */

export function MapNotebookNode({ data, selected }: NodeProps<Node<NotebookNodeData, 'mapNotebook'>>) {
  const { notebook, status } = data;
  const contract =
    notebook.inputs.length > 0 || notebook.outputs.length > 0
      ? `(${notebook.inputs.join(', ') || 'no inputs'}) → {${notebook.outputs.join(', ') || 'nothing'}}`
      : 'no contract';

  return (
    <div
      className={cn(
        'w-[260px] border bg-node-bg shadow-sm transition-all cursor-pointer',
        selected ? 'border-primary shadow-md' : 'border-border hover:border-primary/50',
        status === 'running' && 'border-status-running',
        status === 'error' && 'border-status-error'
      )}
    >
      <Handle type="target" position={Position.Left} className="!bg-muted-foreground !w-2 !h-2" />

      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/60 bg-muted/20">
        <div
          className={cn(
            'w-1.5 h-1.5 shrink-0',
            status === 'running' && 'bg-status-running status-running-pulse',
            status === 'done' && 'bg-status-done',
            status === 'error' && 'bg-status-error',
            !status && 'bg-status-idle'
          )}
        />
        <span className="text-xs font-bold truncate flex-1">{notebook.name}</span>
        <span className="text-[9px] uppercase tracking-wider text-muted-foreground/70 shrink-0">
          {notebook.runtime === 'python' ? 'py' : 'js'}
        </span>
      </div>

      <div className="px-3 py-2 space-y-1.5">
        <div className="font-mono text-[10px] text-muted-foreground truncate" title={contract}>
          {contract}
        </div>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground/70">
          <span>
            {notebook.cellCount} cell{notebook.cellCount === 1 ? '' : 's'}
          </span>
          {notebook.parallelCount > 0 && (
            <span className="flex items-center gap-1 text-primary/80">
              <ArrowsSplit size={11} weight="bold" />
              {notebook.parallelCount} parallel
            </span>
          )}
          {notebook.secrets.length > 0 && <span>{notebook.secrets.length} secret</span>}
        </div>
      </div>

      <Handle type="source" position={Position.Right} className="!bg-muted-foreground !w-2 !h-2" />
    </div>
  );
}

export function MapTriggerNode({ data }: NodeProps<Node<TriggerNodeData, 'mapTrigger'>>) {
  const { trigger } = data;
  const Icon = trigger.kind === 'cron' ? Clock : Globe;

  return (
    <div
      className={cn(
        'w-[210px] border bg-background px-3 py-2 flex items-center gap-2 shadow-sm',
        trigger.enabled ? 'border-primary/40' : 'border-border border-dashed opacity-60'
      )}
    >
      <Icon size={14} weight="duotone" className="text-primary shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-[9px] uppercase tracking-widest text-muted-foreground/70">
          {trigger.kind}
          {!trigger.enabled && ' · off'}
        </div>
        <div className="font-mono text-[11px] truncate" title={trigger.label}>
          {trigger.label}
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-primary !w-2 !h-2" />
    </div>
  );
}

/** One cell inside a notebook, at the second altitude. */
export function MapCellNode({ data, selected }: NodeProps<Node<CellNodeData, 'mapCell'>>) {
  const { index, label, hasCode, laneLabel, status, ms } = data;

  return (
    <div
      className={cn(
        'w-[240px] border bg-node-bg shadow-sm px-3 py-2',
        selected ? 'border-primary' : 'border-border',
        !hasCode && 'border-dashed opacity-70',
        status === 'running' && 'border-status-running',
        status === 'done' && 'border-status-done/60',
        status === 'error' && 'border-status-error'
      )}
    >
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground !w-2 !h-2" />

      <div className="flex items-center gap-2">
        <span className="text-[9px] font-bold text-muted-foreground/60 shrink-0">{index}</span>
        <span className="text-[11px] truncate flex-1" title={label}>
          {label}
        </span>
        {ms !== undefined ? (
          <span className="text-[9px] text-muted-foreground/70 shrink-0 font-mono">
            {ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`}
          </span>
        ) : (
          !hasCode && (
            <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60 shrink-0">
              {label === 'empty cell' ? 'empty' : 'note'}
            </span>
          )
        )}
      </div>
      {laneLabel && (
        <div className="text-[9px] uppercase tracking-widest text-primary/70 mt-1">{laneLabel}</div>
      )}

      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground !w-2 !h-2" />
    </div>
  );
}

/** A call leaving this notebook, clickable so the map keeps being a way to travel. */
export function MapCallOutNode({ data }: NodeProps<Node<CallOutNodeData, 'mapCallOut'>>) {
  return (
    <div
      className={cn(
        'w-[180px] border border-dashed px-3 py-2 bg-background',
        data.notebookId ? 'border-primary/50 cursor-pointer' : 'border-status-error/60'
      )}
      title={data.notebookId ? 'Open this notebook' : 'This call resolves to nothing'}
    >
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground !w-2 !h-2" />
      <div className="flex items-center gap-1.5">
        <ArrowSquareOut size={12} weight="duotone" className="text-primary shrink-0" />
        <span className="font-mono text-[11px] truncate">{data.label}</span>
      </div>
    </div>
  );
}

const UNRESOLVED_COPY = {
  missing: { icon: Warning, text: 'no such notebook' },
  ambiguous: { icon: Warning, text: 'more than one notebook has this name' },
  computed: { icon: Question, text: 'target decided at run time' },
} as const;

export function MapUnresolvedNode({ data }: NodeProps<Node<UnresolvedNodeData, 'mapUnresolved'>>) {
  const { icon: Icon, text } = UNRESOLVED_COPY[data.reason];
  const isBroken = data.reason !== 'computed';

  return (
    <div
      className={cn(
        'w-[190px] border border-dashed px-3 py-2 bg-background',
        isBroken ? 'border-status-error/60' : 'border-border'
      )}
      title={text}
    >
      <Handle type="target" position={Position.Left} className="!bg-muted-foreground !w-2 !h-2" />
      <div className="flex items-center gap-1.5">
        <Icon
          size={12}
          weight="duotone"
          className={cn('shrink-0', isBroken ? 'text-status-error' : 'text-muted-foreground')}
        />
        <span className="font-mono text-[11px] truncate">{data.label}</span>
      </div>
      <div className="text-[9px] text-muted-foreground/70 mt-0.5">{text}</div>
    </div>
  );
}
