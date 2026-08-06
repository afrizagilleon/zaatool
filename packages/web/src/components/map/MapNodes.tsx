import { Handle, Position } from '@xyflow/react';
import type { Node, NodeProps } from '@xyflow/react';
import {
  Clock,
  Globe,
  Warning,
  Question,
  ArrowsSplit,
  ArrowSquareOut,
  Key,
  Package,
} from '@phosphor-icons/react';
import { cn } from '../../lib/utils';
import type {
  CallOutNodeData,
  CallsNodeData,
  CellNodeData,
  NotebookNodeData,
  TriggerNodeData,
} from '../../lib/map-graph';

/**
 * The map's three kinds of box.
 *
 * Presentational only — no fetching, no store. What they show comes from the derived
 * map, so a box on screen is a fact about the notebooks rather than something someone
 * once drew and forgot to update.
 */

/**
 * One notebook, small enough that twenty-nine of them fit.
 *
 * It was 260×116 and carried the whole contract in monospace. At twenty-nine notebooks
 * that is unreadable at every zoom that fits them on a screen — so the box is now 190×46
 * and says only what you scan for: whether it is deployed, what it is called, and four
 * marks. Everything else is in `title`, one hover away, which is the right place for the
 * detail you want about *one* of them.
 *
 * The deploy square is first because it changes what the box means. A trigger on an
 * undeployed notebook fires nothing, and until now the only way to know was to open it.
 */
export function MapNotebookNode({ data, selected }: NodeProps<Node<NotebookNodeData, 'mapNotebook'>>) {
  const { notebook, status, dimmed } = data;
  const contract =
    notebook.inputs.length > 0 || notebook.outputs.length > 0
      ? `(${notebook.inputs.join(', ') || 'no inputs'}) → {${notebook.outputs.join(', ') || 'nothing'}}`
      : 'no contract';

  const detail = [
    notebook.name,
    notebook.deployed ? 'deployed' : 'not deployed',
    contract,
    `${notebook.cellCount} cell${notebook.cellCount === 1 ? '' : 's'}`,
    notebook.parallelCount > 0 ? `${notebook.parallelCount} parallel` : null,
    notebook.secrets.length > 0 ? `secrets: ${notebook.secrets.join(', ')}` : null,
    // On the map because changing it is a production change, and it was in the data all
    // along without ever being drawn.
    notebook.packages.length > 0 ? `packages: ${notebook.packages.join(', ')}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  return (
    <div
      title={detail}
      className={cn(
        'w-[190px] h-[46px] border bg-node-bg shadow-sm transition-opacity cursor-pointer',
        'flex flex-col justify-center px-2.5 py-1',
        selected ? 'border-primary shadow-md' : 'border-border hover:border-primary/50',
        status === 'running' && 'border-status-running',
        status === 'error' && 'border-status-error',
        // Dimmed rather than removed while something else is focused: a map that deletes
        // its context to show you one thing has stopped being a map.
        dimmed && 'opacity-25'
      )}
    >
      <Handle type="target" position={Position.Left} className="!bg-muted-foreground !w-2 !h-2" />

      <div className="flex items-center gap-1.5">
        {/* Filled when production runs a version of this; hollow when nothing does. */}
        <div
          aria-label={notebook.deployed ? 'Deployed' : 'Not deployed'}
          className={cn(
            'w-1.5 h-1.5 shrink-0 border',
            status === 'running'
              ? 'bg-status-running border-status-running status-running-pulse'
              : status === 'error'
                ? 'bg-status-error border-status-error'
                : notebook.deployed
                  ? 'bg-status-done border-status-done'
                  : 'border-muted-foreground/50'
          )}
        />
        <span className="text-[11px] font-bold truncate flex-1">{notebook.name}</span>
        <span className="text-[9px] uppercase tracking-wider text-muted-foreground/70 shrink-0">
          {notebook.runtime === 'python' ? 'py' : 'js'}
        </span>
      </div>

      <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground/70 mt-0.5">
        <span>{notebook.cellCount}c</span>
        {notebook.parallelCount > 0 && (
          <ArrowsSplit size={9} weight="bold" className="text-primary/80" />
        )}
        {notebook.secrets.length > 0 && <Key size={9} weight="duotone" />}
        {notebook.packages.length > 0 && (
          <span className="flex items-center gap-0.5">
            <Package size={9} weight="duotone" />
            {notebook.packages.length}
          </span>
        )}
        {notebook.inputs.length + notebook.outputs.length === 0 && (
          <span className="italic opacity-70">no contract</span>
        )}
      </div>

      <Handle type="source" position={Position.Right} className="!bg-muted-foreground !w-2 !h-2" />
    </div>
  );
}

export function MapTriggerNode({ data }: NodeProps<Node<TriggerNodeData, 'mapTrigger'>>) {
  const { trigger, dimmed } = data;
  const Icon = trigger.kind === 'cron' ? Clock : Globe;

  return (
    <div
      title={`${trigger.kind} ${trigger.label}${trigger.enabled ? '' : ' — switched off'}`}
      className={cn(
        'w-[170px] h-[44px] border bg-background px-2.5 flex items-center gap-1.5 shadow-sm',
        'transition-opacity',
        trigger.enabled ? 'border-primary/40' : 'border-border border-dashed opacity-60',
        // Dims with the notebook it fires. A bright trigger wired to a faded box is an
        // arrow whose two ends disagree about whether you are looking at them.
        dimmed && 'opacity-25'
      )}
    >
      <Icon size={13} weight="duotone" className="text-primary shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-[8px] uppercase tracking-widest text-muted-foreground/70">
          {trigger.kind}
          {!trigger.enabled && ' · off'}
        </div>
        <div className="font-mono text-[10px] truncate">{trigger.label}</div>
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

const PROBLEM_COPY = {
  missing: { icon: Warning, text: 'no such notebook' },
  ambiguous: { icon: Warning, text: 'more than one notebook has this name' },
  computed: { icon: Question, text: 'target decided at run time' },
} as const;

/**
 * Everything one notebook calls, listed under it.
 *
 * This replaces an edge per call. With nine notebooks calling four shared ones, that was
 * thirteen long curves crossing every band of the map — and it got worse the more the
 * system reused, which is exactly backwards: reuse is the thing a map should reward.
 *
 * A list reads in the direction the eye is already travelling and grows downwards rather
 * than outwards. The names stay clickable, so the map is still a way to get somewhere.
 * Calls that resolve to nothing stay in the list rather than becoming a box of their own:
 * a broken call is a fact about *this* notebook, and that is where it belongs.
 */
export function MapCallsNode({ data }: NodeProps<Node<CallsNodeData, 'mapCalls'>>) {
  return (
    <div
      className={cn(
        'w-[168px] border border-dashed border-border/70 bg-background/80 px-1.5 pb-1.5 pt-0.5',
        'transition-opacity',
        data.dimmed && 'opacity-25'
      )}
    >
      <div className="text-[8px] uppercase tracking-widest text-muted-foreground/60">calls</div>
      <ul>
        {data.targets.map((target, index) => {
          const problem = target.problem ? PROBLEM_COPY[target.problem] : null;
          const Icon = problem?.icon;
          return (
            <li
              key={`${target.label}-${index}`}
              // `nodrag` so a click reaches the name instead of starting a pan, and the
              // id is what `onNodeClick` reads to know where to travel.
              data-call-target={target.notebookId ?? ''}
              title={problem ? `${target.label} — ${problem.text}` : `Open ${target.label}`}
              className={cn(
                'nodrag flex h-[13px] items-center gap-1 font-mono text-[9px] leading-none',
                target.notebookId
                  ? 'cursor-pointer text-foreground/80 hover:text-primary hover:underline'
                  : 'text-status-error'
              )}
            >
              {Icon && <Icon size={9} weight="duotone" className="shrink-0" />}
              <span className="truncate">{target.label}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
