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
  List,
  ListChecks,
} from '@phosphor-icons/react';
import type { NotebookRuntime } from '@zaa-tool/shared';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { NotebookSecrets } from './NotebookSecrets';
import { NotebookPackages } from './NotebookPackages';
import { NotebookTags } from './NotebookTags';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerRow,
  DrawerTitle,
  DrawerTrigger,
} from '../ui/drawer';
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

/** One labelled part of Setup: in the popover on a wide screen, in the drawer on a phone. */
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
  /** Labels this notebook carries, for finding it again in a list of twenty-nine. */
  tags: string[];
  isDirty: boolean;
  isSaving: boolean;
  isRunning: boolean;
  staleCount: number;
  /** Rendered between the fold toggles and Save; owned by the editor. */
  runHistory?: React.ReactNode;
  /** Opens the map already inside this notebook. */
  mapButton?: React.ReactNode;
  /** The deploy gate, owned by the editor because it needs the saved notebook's id. */
  deployButton?: React.ReactNode;
  /** Downloads the notebook as the text form. Absent until it has been saved once. */
  exportButton?: React.ReactNode;
  /** Trigger editor, shown in a popover next to Secrets. */
  triggerPanel?: React.ReactNode;
  triggerCount: number;
  /** Reuse contract editor, in a popover of its own. */
  contractPanel?: React.ReactNode;
  /** Outline panel for viewing cells, searching and folding. */
  outlinePanel?: React.ReactNode;
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
  onTagsChange: (tags: string[]) => void;
  onSave: () => void;
  onRun: () => void;
  onBack: () => void;
}

/**
 * Everything you can do to the notebook you are looking at.
 *
 * Ten controls, and until now ten controls in one non-wrapping row at fixed widths. On a
 * wide screen that reads fine. At 375px it measured about 700, so more than half of it —
 * Setup, Save, Deploy, Run — sat past the right edge with nothing to scroll. The editor
 * was not cramped on a phone; it was unreachable.
 *
 * Two layouts now, from one set of definitions. Wide keeps the row. Narrow keeps the four
 * things reached for constantly — back, the name, save, run — and puts the rest in a
 * drawer, where each gets a label and a row tall enough to hit with a thumb.
 */
export function NotebookToolbar({
  name,
  runtime,
  secrets,
  packages,
  tags,
  isDirty,
  isSaving,
  isRunning,
  staleCount,
  runHistory,
  mapButton,
  deployButton,
  exportButton,
  triggerPanel,
  triggerCount,
  contractPanel,
  outlinePanel,
  contractShape,
  isPreviewing,
  onTogglePreview,
  allCollapsed,
  onToggleAllSections,
  onNameChange,
  onRuntimeChange,
  onSecretsChange,
  onPackagesChange,
  onTagsChange,
  onSave,
  onRun,
  onBack,
}: NotebookToolbarProps) {
  const hiddenCount = SECTIONS.filter((section) => allCollapsed[section.id]).length;
  // One number on the button, so folding the four panels away does not also hide the
  // fact that there is anything in them.
  const setupCount =
    contractShape.inputs + contractShape.outputs + triggerCount + secrets.length + packages.length;

  /**
   * The controls, written once and placed twice.
   *
   * What must never happen is two definitions of Save that drift apart, so each control
   * is a value here and the two layouts below only decide where it goes.
   */
  const runtimeSelect = (
    <Select value={runtime} onValueChange={(value) => onRuntimeChange(value as NotebookRuntime)}>
      <SelectTrigger className="h-7 w-32 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="node" className="text-xs">JavaScript</SelectItem>
        <SelectItem value="python" className="text-xs">Python</SelectItem>
      </SelectContent>
    </Select>
  );

  const uvBadge = runtime === 'python' && packages.length > 0 && (
    <span
      className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-mono text-muted-foreground"
      title="uv package manager required for declared Python packages"
      data-testid="uv-indicator"
    >
      uv
    </span>
  );

  const staleWarning = staleCount > 0 && (
    <span
      className="flex items-center gap-1 text-[10px] font-semibold text-amber-500"
      title="These cells were edited after they last ran — their output no longer matches the code"
    >
      <Warning size={12} weight="fill" />
      {staleCount} stale
    </span>
  );

  // Folding every cell at once is what keeps a long notebook readable — one menu rather
  // than three buttons competing for the toolbar.
  const viewMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[10px] font-semibold text-muted-foreground hover:text-foreground"
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
  );

  // Seeing your page used to mean deploying it, which turned the deploy gate into a way
  // of looking rather than a decision.
  const pageToggle = (
    <Button
      variant="ghost"
      size="sm"
      className={cn(
        'h-7 px-2 text-[10px] font-semibold',
        isPreviewing ? 'text-foreground bg-muted' : 'text-muted-foreground hover:text-foreground'
      )}
      onClick={() => onTogglePreview(!isPreviewing)}
      title={isPreviewing ? 'Back to the cells' : 'See the page this contract makes'}
    >
      <AppWindow size={12} className="mr-1" />
      Page
    </Button>
  );

  // Contract, triggers, secrets and packages are configuration — opened now and then, not
  // every minute — so they live behind one labelled button rather than four. They were
  // icon-only for a while and that was a mistake: an icon has to be *conventional* to
  // replace a word, and there is no conventional icon for "the contract this notebook
  // exposes". A word never needs to be learned.
  const setupSections = (
    <>
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
      <SetupSection label="Tags" hint={tags.length > 0 ? `${tags.length} set` : 'none'}>
        <div className="p-3">
          <NotebookTags tags={tags} onChange={onTagsChange} />
        </div>
      </SetupSection>
      <SetupSection
        label="Packages"
        hint={packages.length > 0 ? `${packages.length} declared` : 'standard library only'}
      >
        <div className="p-3">
          <NotebookPackages runtime={runtime} packages={packages} onChange={onPackagesChange} />
        </div>
      </SetupSection>
    </>
  );

  const saveButton = (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground shrink-0"
      onClick={onSave}
      disabled={isSaving || !isDirty}
      title={isDirty ? 'Save this notebook' : 'Nothing to save'}
    >
      {isSaving ? <Spinner size={13} className="animate-spin" /> : <FloppyDisk size={13} />}
      {/* The word is what makes a disk icon unambiguous, and a phone has no room for it,
          so there the title attribute carries it instead. */}
      <span className="ml-1.5 hidden lg:inline">Save</span>
    </Button>
  );

  return (
    <div className="flex items-center gap-2 px-3 h-11 border-b border-border shrink-0">
      <Button variant="ghost" size="icon" className="w-7 h-7 shrink-0" onClick={onBack} title="Back to notebooks">
        <ArrowLeft size={14} />
      </Button>

      {/* The name takes whatever is left. It was a fixed `w-56` between nine other fixed
          widths, which is how a toolbar came to be 700px wide inside a 375px screen. */}
      <Input
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        className="h-7 min-w-0 flex-1 text-xs font-semibold lg:w-56 lg:flex-none"
        placeholder="Notebook name"
      />

      {/* ── wide ── */}
      <div className="hidden min-w-0 flex-1 items-center gap-2 lg:flex">
        {runtimeSelect}
        {uvBadge}
        {staleWarning}
        <div className="flex-1" />
        {viewMenu}
        {pageToggle}
        {runHistory}
        {mapButton}
        {exportButton}
        <Divider />
        {outlinePanel && (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground shrink-0"
                title="Outline"
              >
                <ListChecks size={13} className="mr-1.5" />
                Outline
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[340px] p-0 max-h-[70vh] overflow-y-auto">
              {outlinePanel}
            </PopoverContent>
          </Popover>
        )}
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
            {setupSections}
          </PopoverContent>
        </Popover>
        <Divider />
        {saveButton}
        {deployButton}
      </div>

      {/* ── narrow ── */}
      {/* Kept in the bar: going back, the name, saving, running. Everything else is an
          occasional decision, and occasional decisions belong somewhere with room to
          label them rather than squeezed into a row nobody can reach the end of. */}
      <div className="flex shrink-0 items-center gap-1 lg:hidden">
        {isDirty && (
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500"
            title="Unsaved changes"
            aria-label="Unsaved changes"
          />
        )}
        {saveButton}

        <Drawer>
          <DrawerTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              title="Everything else"
              aria-label="Everything else"
            >
              <List size={16} />
            </Button>
          </DrawerTrigger>
          <DrawerContent side="right" className="p-0">
            <DrawerHeader>
              <DrawerTitle>{name || 'Untitled notebook'}</DrawerTitle>
            </DrawerHeader>

            <DrawerRow className="justify-between">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Runtime</span>
              <div className="flex items-center gap-1.5">
                {runtimeSelect}
                {uvBadge}
              </div>
            </DrawerRow>

            {staleWarning && <DrawerRow>{staleWarning}</DrawerRow>}

            <DrawerRow className="flex-wrap gap-2 border-y border-border">
              {pageToggle}
              {viewMenu}
              {runHistory}
              {mapButton}
              {exportButton}
            </DrawerRow>

            {deployButton && (
              <DrawerRow className="justify-between border-b border-border">
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Deploy</span>
                {deployButton}
              </DrawerRow>
            )}

            {/* The setup panels are the tall part, and they are what the drawer scrolls. */}
            <div className="min-h-0 shrink-0">{setupSections}</div>
          </DrawerContent>
        </Drawer>
      </div>

      <Button size="sm" className="h-7 px-3 text-xs shrink-0" onClick={onRun} disabled={isRunning}>
        {isRunning ? <Spinner size={13} className="animate-spin mr-1.5" /> : <Play size={13} weight="fill" className="mr-1.5" />}
        Run
        <span className="ml-1 hidden lg:inline">all</span>
      </Button>
    </div>
  );
}
