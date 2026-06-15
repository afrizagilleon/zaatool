import {
  Sun,
  Moon,
  Play,
  Spinner,
  Sidebar,
  Terminal,
  Sparkle,
  FloppyDisk,
  RocketLaunch,
} from '@phosphor-icons/react';
import { useUiStore } from '../../store/uiStore';
import { useEngineStore } from '../../store/engineStore';
import { useAutoLayout } from '../../hooks/useAutoLayout';
import { useNavbarActions } from '../../hooks/useNavbarActions';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { useEffect } from 'react';
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs';

const navTabs = [
  { id: 'workflows' as const, label: 'Workflows', disabled: false },
  { id: 'editor' as const, label: 'Editor', disabled: false },
  { id: 'resources' as const, label: 'Resources', disabled: false },
] as const;

export function Navbar() {
  const isDarkMode = useUiStore((s) => s.isDarkMode);
  const toggleDarkMode = useUiStore((s) => s.toggleDarkMode);
  const activeTab = useUiStore((s) => s.activeTab);
  const setActiveTab = useUiStore((s) => s.setActiveTab);
  const isNodePaletteOpen = useUiStore((s) => s.isNodePaletteOpen);
  const toggleNodePalette = useUiStore((s) => s.toggleNodePalette);
  const isConsolePanelOpen = useUiStore((s) => s.isConsolePanelOpen);
  const toggleConsolePanel = useUiStore((s) => s.toggleConsolePanel);
  const isAiPanelOpen = useUiStore((s) => s.isAiPanelOpen);
  const toggleAiPanel = useUiStore((s) => s.toggleAiPanel);

  const isRunning = useEngineStore((s) => s.isRunning);
  const wsConnected = useEngineStore((s) => s.wsConnected);
  const autoLayout = useAutoLayout();
  const layoutDirection = useUiStore((s) => s.layoutDirection);
  const setLayoutDirection = useUiStore((s) => s.setLayoutDirection);

  const { isSaving, run, save, load } = useNavbarActions();

  useEffect(() => {
    // Initial auto-load
    load();
  }, [load]);

  return (
    <header
      id="navbar"
      className="flex h-11 items-center border-b border-border bg-background/80 backdrop-blur-sm px-3 gap-1 shrink-0 z-50"
    >
      {/* Logo */}
      <div id="navbar-logo" className="flex items-center gap-2 mr-3 select-none">
        <div className="flex items-center justify-center w-6 h-6 bg-primary/15">
          <span className="text-[11px] font-black tracking-tighter text-primary leading-none">
            z
          </span>
        </div>
        <span className="text-sm font-bold tracking-tight text-foreground">
          zaa
        </span>
      </div>

      {/* Divider */}
      <div className="w-px h-5 bg-border mr-1" />

      {/* Center: Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={(val: string) => setActiveTab(val as any)}
        className="w-[300px]"
      >
        <TabsList className="grid w-full grid-cols-3 h-7 p-0.5">
          {navTabs.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id} className="text-xs h-6" disabled={tab.disabled}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Palette toggle */}
      <Button
        id="navbar-toggle-palette"
        onClick={toggleNodePalette}
        variant="ghost"
        size="icon"
        className={cn(
          'w-7 h-7 ml-1',
          isNodePaletteOpen ? 'bg-accent text-foreground' : 'text-muted-foreground'
        )}
        title="Toggle node palette"
      >
        <Sidebar size={15} weight="duotone" />
      </Button>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Storage Actions */}
      <div className="flex items-center gap-1 mr-2">
        <Button
          onClick={save}
          disabled={isSaving}
          variant="ghost"
          className="h-7 px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          {isSaving ? (
            <Spinner size={14} className="animate-spin mr-1.5" />
          ) : (
            <FloppyDisk size={14} className="mr-1.5" />
          )}
          Save
        </Button>

        <div className="h-4 w-px bg-border mx-1" />

        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground relative group"
          disabled
        >
          <RocketLaunch size={16} className="mr-1.5" />
          Deploy
          <span className="absolute -top-1 -right-2 text-[8px] bg-primary/20 text-primary px-1 font-bold group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
            SOON
          </span>
        </Button>

        <div className="h-4 w-px bg-border mx-1" />
      </div>

      {/* Auto Layout buttons */}
      <div className="flex items-center bg-muted/30 p-0.5 mr-1">
        <Button
          id="navbar-layout-tb"
          onClick={() => {
            setLayoutDirection('TB');
            autoLayout('TB');
          }}
          variant="ghost"
          className={cn(
            'h-6 px-2 text-[11px] font-semibold',
            layoutDirection === 'TB' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:bg-muted/50'
          )}
          title="Auto layout (Vertical)"
        >
          V
        </Button>
        <Button
          id="navbar-layout-lr"
          onClick={() => {
            setLayoutDirection('LR');
            autoLayout('LR');
          }}
          variant="ghost"
          className={cn(
            'h-6 px-2 text-[11px] font-semibold',
            layoutDirection === 'LR' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:bg-muted/50'
          )}
          title="Auto layout (Horizontal)"
        >
          H
        </Button>
      </div>

      {/* Console toggle */}
      <Button
        id="navbar-toggle-console"
        onClick={toggleConsolePanel}
        variant="ghost"
        size="icon"
        className={cn(
          'w-7 h-7 mr-1',
          isConsolePanelOpen ? 'bg-accent text-foreground' : 'text-muted-foreground'
        )}
        title="Toggle console"
      >
        <Terminal size={15} weight="duotone" />
      </Button>

      {/* AI Assistant toggle */}
      <Button
        id="navbar-toggle-ai"
        onClick={toggleAiPanel}
        variant="ghost"
        size="icon"
        className={cn(
          'w-7 h-7 mr-1',
          isAiPanelOpen ? 'bg-primary/20 text-primary' : 'text-muted-foreground'
        )}
        title="Toggle AI Assistant"
      >
        <Sparkle size={15} weight="duotone" />
      </Button>

      {/* Connection indicator */}
      <div
        id="navbar-ws-status"
        className="flex items-center gap-1.5 text-[10px] text-muted-foreground mr-2"
        title={wsConnected ? 'Engine connected' : 'Engine disconnected'}
      >
        <div
          className={cn(
            'w-1.5 h-1.5 transition-colors',
            wsConnected ? 'bg-status-done' : 'bg-status-idle'
          )}
        />
        <span className="hidden sm:inline">{wsConnected ? 'Connected' : 'Offline'}</span>
      </div>

      {/* Dark mode toggle */}
      <Button
        id="navbar-theme-toggle"
        onClick={toggleDarkMode}
        variant="ghost"
        size="icon"
        className="w-7 h-7 text-muted-foreground"
        title={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        {isDarkMode ? <Sun size={15} weight="duotone" /> : <Moon size={15} weight="duotone" />}
      </Button>

      {/* Run button */}
      <Button
        id="navbar-run-button"
        onClick={run}
        disabled={isRunning}
        variant="default"
        className={cn(
          'h-7 px-3 text-xs font-semibold ml-1',
          isRunning
            ? 'bg-emerald-500/15 text-emerald-400 opacity-100 cursor-wait'
            : 'bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400 dark:hover:bg-emerald-500/20'
        )}
      >
        {isRunning ? (
          <>
            <Spinner size={13} className="animate-spin mr-1.5" />
            Running
          </>
        ) : (
          <>
            <Play size={13} weight="fill" className="mr-1.5" />
            Run
          </>
        )}
      </Button>
    </header>
  );
}
