import {
  Play,
  Spinner,
  FloppyDisk,
  ArrowLeft,
  Warning,
  Eye,
  EyeSlash,
  SlidersHorizontal,
  CaretDown,
  AppWindow,
} from '@phosphor-icons/react';
import type { NotebookRuntime } from '@zaa-tool/shared';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { NotebookSecrets } from './NotebookSecrets';
import { NotebookPackages } from './NotebookPackages';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import type { CellSection } from '../../store/notebookTypes';

/** Marks where one group of controls ends and the next begins. */
function Divider() {
  return <div className="h-4 w-px bg-border/70 mx-0.5 shrink-0" />;
}

/** One labelled part of the Setup popover. */
function SetupSection({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-border last:border-b-0">
      <header className="flex items-baseline gap-2 px-3 py-2 bg-muted/30">
        <h3 className="text-[10px] font-semibold uppercase tracking-widest">{label}</h3>
        <span className="text-[10px] text-muted-foreground/70">{hint}</span>
      </header>
      {children}
    </section>
  );
}

const SECTIONS: { id: CellSection; label: string }[] = [
  { id: 'note', label: 'Notes' },
  { id: 'code', label: 'Code' },
  { id: 'output', label: 'Output' },
];

interface NotebookToolbarProps {
  name: string;
  runtime: NotebookRuntime;
  secrets: string[];
  packages: string[];
  isDirty: boolean;
  isSaving: boolean;
  isRunning: boolean;
  staleCount: number;
  /** Rendered between the fold toggles and Save; owned by the editor. */
  runHistory?: React.ReactNode;
  /** The deploy gate, owned by the editor because it needs the saved notebook's id. */
  deployButton?: React.ReactNode;
  /** Downloads the notebook as the text form. Absent until it has been saved once. */
  exportButton?: React.ReactNode;
  /** Trigger editor, shown in a popover next to Secrets. */
  triggerPanel?: React.ReactNode;
  triggerCount: number;
  /** Reuse contract editor, in a popover of its own. */
  contractPanel?: React.ReactNode;
  /** Shown as "in → out" so the shape is readable without opening the panel. */
  contractShape: { inputs: number; outputs: number };
  /** Whether the body shows the page this contract makes instead of the cells. */
  isPreviewing: boolean;
  onTogglePreview: (previewing: boolean) => void;
  /** Which sections are folded across every cell, for the all-or-nothing toggles. */
  allCollapsed: Record<CellSection, boolean>;
  onToggleAllSections: (section: CellSection, isCollapsed: boolean) => void;
  onNameChange: (name: string) => void;
  onRuntimeChange: (runtime: NotebookRuntime) => void;
  onSecretsChange: (secrets: string[]) => void;
  onPackagesChange: (packages: string[]) => void;
  onSave: () => void;
  onRun: () => void;
  onBack: () => void;
}

export function NotebookToolbar({
  name,
  runtime,
  secrets,
  packages,
  isDirty,
  isSaving,
  isRunning,
  staleCount,
  runHistory,
  deployButton,
  exportButton,
  triggerPanel,
  triggerCount,
  contractPanel,
  contractShape,
  isPreviewing,
  onTogglePreview,
  allCollapsed,
  onToggleAllSections,
  onNameChange,
  onRuntimeChange,
  onSecretsChange,
  onPackagesChange,
  onSave,
  onRun,
  onBack,
}: NotebookToolbarProps) {
  const hiddenCount = SECTIONS.filter((section) => allCollapsed[section.id]).length;
  // One number on the button, so folding the three panels away does not also hide the
  // fact that there is anything in them.
  const setupCount =
    contractShape.inputs + contractShape.outputs + triggerCount + secrets.length + packages.length;

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

      {/* Seeing your page used to mean deploying it, which turned the deploy gate into a
          way of looking rather than a decision. */}
      <Button
        variant="ghost"
        size="sm"
        className={cn(
          'h-7 px-2 text-[10px] font-semibold mr-1',
          isPreviewing ? 'text-foreground bg-muted' : 'text-muted-foreground hover:text-foreground'
        )}
        onClick={() => onTogglePreview(!isPreviewing)}
        title={isPreviewing ? 'Back to the cells' : 'See the page this contract makes'}
      >
        <AppWindow size={12} className="mr-1" />
        Page
      </Button>

      {runHistory}

      {exportButton}

      <Divider />

      {/* Contract, triggers and secrets are configuration — opened now and then, not
          every minute — so they live behind one labelled button rather than three.
          They were icon-only for a while and that was a mistake: an icon has to be
          *conventional* to replace a word, and there is no conventional icon for "the
          contract this notebook exposes". A word never needs to be learned. */}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground shrink-0"
          >
            <SlidersHorizontal size={13} className="mr-1.5" />
            Setup
            {setupCount > 0 && (
              <span className="ml-1.5 text-[10px] text-muted-foreground/60">{setupCount}</span>
            )}
            <CaretDown size={10} className="ml-1 opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[380px] p-0 max-h-[70vh] overflow-y-auto">
          <SetupSection label="Contract" hint={`${contractShape.inputs} in · ${contractShape.outputs} out`}>
            {contractPanel}
          </SetupSection>
          <SetupSection label="Triggers" hint={triggerCount > 0 ? `${triggerCount} set up` : 'none'}>
            {triggerPanel}
          </SetupSection>
          <SetupSection label="Secrets" hint={secrets.length > 0 ? `${secrets.length} allowed` : 'none'}>
            <div className="p-3">
              <NotebookSecrets selectedKeys={secrets} onChange={onSecretsChange} />
            </div>
          </SetupSection>
          <SetupSection
            label="Packages"
            hint={packages.length > 0 ? `${packages.length} declared` : 'standard library only'}
          >
            <div className="p-3">
              <NotebookPackages
                runtime={runtime}
                packages={packages}
                onChange={onPackagesChange}
              />
            </div>
          </SetupSection>
        </PopoverContent>
      </Popover>

      <Divider />

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

      {deployButton}

      <Button size="sm" className="h-7 px-3 text-xs" onClick={onRun} disabled={isRunning}>
        {isRunning ? <Spinner size={13} className="animate-spin mr-1.5" /> : <Play size={13} weight="fill" className="mr-1.5" />}
        Run all
      </Button>
    </div>
  );
}
