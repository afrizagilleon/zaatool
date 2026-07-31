import { Play, Spinner, FloppyDisk, ArrowLeft, Warning, Eye, EyeSlash } from '@phosphor-icons/react';
import type { NotebookRuntime } from '@zaa-tool/shared';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { NodeSecretsProperties } from '../panels/properties/NodeSecretsProperties';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import type { CellSection } from '../../store/notebookTypes';

const SECTIONS: { id: CellSection; label: string }[] = [
  { id: 'note', label: 'Notes' },
  { id: 'code', label: 'Code' },
  { id: 'output', label: 'Output' },
];

interface NotebookToolbarProps {
  name: string;
  runtime: NotebookRuntime;
  secrets: string[];
  isDirty: boolean;
  isSaving: boolean;
  isRunning: boolean;
  staleCount: number;
  /** Rendered between the fold toggles and Save; owned by the editor. */
  runHistory?: React.ReactNode;
  /** Trigger editor, shown in a popover next to Secrets. */
  triggerPanel?: React.ReactNode;
  triggerCount: number;
  /** Reuse contract editor, in a popover of its own. */
  contractPanel?: React.ReactNode;
  /** Shown as "in → out" so the shape is readable without opening the panel. */
  contractShape: { inputs: number; outputs: number };
  /** Which sections are folded across every cell, for the all-or-nothing toggles. */
  allCollapsed: Record<CellSection, boolean>;
  onToggleAllSections: (section: CellSection, isCollapsed: boolean) => void;
  onNameChange: (name: string) => void;
  onRuntimeChange: (runtime: NotebookRuntime) => void;
  onSecretsChange: (secrets: string[]) => void;
  onSave: () => void;
  onRun: () => void;
  onBack: () => void;
}

export function NotebookToolbar({
  name,
  runtime,
  secrets,
  isDirty,
  isSaving,
  isRunning,
  staleCount,
  runHistory,
  triggerPanel,
  triggerCount,
  contractPanel,
  contractShape,
  allCollapsed,
  onToggleAllSections,
  onNameChange,
  onRuntimeChange,
  onSecretsChange,
  onSave,
  onRun,
  onBack,
}: NotebookToolbarProps) {
  const hiddenCount = SECTIONS.filter((section) => allCollapsed[section.id]).length;

  return (
    <div className="flex items-center gap-2 px-3 h-11 border-b border-border shrink-0">
      <Button variant="ghost" size="icon" className="w-7 h-7" onClick={onBack} title="Back to notebooks">
        <ArrowLeft size={14} />
      </Button>

      <Input
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        className="h-7 w-56 text-xs font-semibold"
        placeholder="Notebook name"
      />

      <Select value={runtime} onValueChange={(value) => onRuntimeChange(value as NotebookRuntime)}>
        <SelectTrigger className="h-7 w-32 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="node" className="text-xs">JavaScript</SelectItem>
          <SelectItem value="python" className="text-xs">Python</SelectItem>
        </SelectContent>
      </Select>

      {staleCount > 0 && (
        <span
          className="flex items-center gap-1 text-[10px] font-semibold text-amber-500"
          title="These cells were edited after they last ran — their output no longer matches the code"
        >
          <Warning size={12} weight="fill" />
          {staleCount} stale
        </span>
      )}

      <div className="flex-1" />

      {/* Folding every cell at once is what keeps a long notebook readable — one
          menu rather than three buttons competing for the toolbar. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[10px] font-semibold text-muted-foreground hover:text-foreground mr-1"
          >
            {hiddenCount > 0 ? <EyeSlash size={12} className="mr-1" /> : <Eye size={12} className="mr-1" />}
            View
            {hiddenCount > 0 && <span className="ml-1 text-muted-foreground/60">{hiddenCount}</span>}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuLabel className="text-[9px] font-semibold uppercase tracking-widest">
            Show in every cell
          </DropdownMenuLabel>
          {SECTIONS.map((section) => (
            <DropdownMenuCheckboxItem
              key={section.id}
              checked={!allCollapsed[section.id]}
              onCheckedChange={(checked) => onToggleAllSections(section.id, !checked)}
              className="text-xs"
            >
              {section.label}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {runHistory}

      <details className="relative">
        <summary className="list-none cursor-pointer text-[10px] font-semibold uppercase tracking-widest text-muted-foreground hover:text-foreground px-2 py-1 select-none">
          Contract
          {contractShape.inputs + contractShape.outputs > 0 && (
            <span className="ml-1 font-mono normal-case tracking-normal text-muted-foreground/70">
              {contractShape.inputs}→{contractShape.outputs}
            </span>
          )}
        </summary>
        <div className="absolute right-0 top-full mt-1 bg-card border border-border shadow-lg z-50">
          {contractPanel}
        </div>
      </details>

      <details className="relative">
        <summary className="list-none cursor-pointer text-[10px] font-semibold uppercase tracking-widest text-muted-foreground hover:text-foreground px-2 py-1 select-none">
          Triggers{triggerCount > 0 ? ` (${triggerCount})` : ''}
        </summary>
        <div className="absolute right-0 top-full mt-1 bg-card border border-border shadow-lg z-50">
          {triggerPanel}
        </div>
      </details>

      <details className="relative">
        <summary className="list-none cursor-pointer text-[10px] font-semibold uppercase tracking-widest text-muted-foreground hover:text-foreground px-2 py-1 select-none">
          Secrets{secrets.length > 0 ? ` (${secrets.length})` : ''}
        </summary>
        <div className="absolute right-0 top-full mt-1 w-64 p-3 bg-card border border-border shadow-lg z-50">
          <NodeSecretsProperties selectedKeys={secrets} onChange={onSecretsChange} />
        </div>
      </details>

      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground"
        onClick={onSave}
        disabled={isSaving || !isDirty}
      >
        {isSaving ? <Spinner size={13} className="animate-spin mr-1.5" /> : <FloppyDisk size={13} className="mr-1.5" />}
        Save
      </Button>

      <Button size="sm" className="h-7 px-3 text-xs" onClick={onRun} disabled={isRunning}>
        {isRunning ? <Spinner size={13} className="animate-spin mr-1.5" /> : <Play size={13} weight="fill" className="mr-1.5" />}
        Run all
      </Button>
    </div>
  );
}
