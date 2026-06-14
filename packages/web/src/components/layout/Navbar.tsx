import {
  Sun,
  Moon,
  Play,
  Spinner,
  Sidebar,
  Terminal,
  Sparkle,
  FloppyDisk,
  FolderOpen
} from '@phosphor-icons/react';
import { useUiStore } from '../../store/uiStore';
import { useEngineStore } from '../../store/engineStore';
import { useFlowStore } from '../../store/flowStore';
import { useAutoLayout } from '../../hooks/useAutoLayout';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { API_BASE_URL } from '../../lib/api';
import { useState, useEffect } from 'react';

const navTabs = [
  { id: 'editor' as const, label: 'Node Editor', disabled: false },
  { id: 'resources' as const, label: 'Resources', disabled: false },
  { id: 'deploys' as const, label: 'Deploys', disabled: true },
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
  const runFlow = useEngineStore((s) => s.runFlow);
  const getGraphJson = useFlowStore((s) => s.getGraphJson);
  const loadFromJson = useFlowStore((s) => s.loadFromJson);
  const autoLayout = useAutoLayout();
  const layoutDirection = useUiStore((s) => s.layoutDirection);
  const setLayoutDirection = useUiStore((s) => s.setLayoutDirection);

  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    // Initial auto-load
    handleLoad();
  }, []);

  const handleRun = () => {
    if (isRunning) return;
    const graph = getGraphJson();
    runFlow(graph);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const graph = getGraphJson();
      const res = await fetch(`${API_BASE_URL}/api/flows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: graph.id,
          name: graph.name,
          graph_json: graph
        })
      });
      if (!res.ok) throw new Error('Failed to save');
      // Toast notification could go here
    } catch (e) {
      console.error(e);
      alert('Failed to save flow to database.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleLoad = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/flows`);
      if (!res.ok) throw new Error('Failed to load');
      const flows = await res.json();
      if (flows.length > 0) {
        const latestFlow = flows[0];
        const parsedGraph = typeof latestFlow.graph_json === 'string' 
          ? JSON.parse(latestFlow.graph_json) 
          : latestFlow.graph_json;
        loadFromJson(parsedGraph);
      }
    } catch (e) {
      console.error(e);
      // Fails silently on first run if DB empty
    } finally {
      setIsLoading(false);
    }
  };

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

      {/* Palette toggle */}
      <Button
        id="navbar-toggle-palette"
        onClick={toggleNodePalette}
        variant="ghost"
        size="icon"
        className={cn(
          'w-7 h-7',
          isNodePaletteOpen
            ? 'bg-accent text-foreground'
            : 'text-muted-foreground'
        )}
        title="Toggle node palette"
      >
        <Sidebar size={15} weight="duotone" />
      </Button>

      {/* Nav tabs */}
      <nav className="flex items-center gap-0.5 ml-1">
        {navTabs.map((tab) => (
          <Button
            key={tab.id}
            id={`navbar-tab-${tab.id}`}
            disabled={tab.disabled}
            onClick={() => !tab.disabled && setActiveTab(tab.id)}
            variant="ghost"
            className={cn(
              'h-7 px-2.5 text-xs font-medium',
              activeTab === tab.id
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground'
            )}
          >
            {tab.label}
            {tab.disabled && (
              <span className="ml-1 text-[9px] text-muted-foreground/40 uppercase tracking-wide">
                soon
              </span>
            )}
          </Button>
        ))}
      </nav>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Storage Actions */}
      <div className="flex items-center gap-1 mr-4 border-r border-border pr-4">
        <Button
          onClick={handleSave}
          disabled={isSaving}
          variant="ghost"
          className="h-7 px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          {isSaving ? <Spinner size={14} className="animate-spin mr-1.5" /> : <FloppyDisk size={14} className="mr-1.5" />}
          Save
        </Button>
        <Button
          onClick={handleLoad}
          disabled={isLoading}
          variant="ghost"
          className="h-7 px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          {isLoading ? <Spinner size={14} className="animate-spin mr-1.5" /> : <FolderOpen size={14} className="mr-1.5" />}
          Load
        </Button>
      </div>

      {/* Auto Layout buttons */}
      <div className="flex items-center bg-muted/30 p-0.5 mr-1">
        <Button
          id="navbar-layout-tb"
          onClick={() => { setLayoutDirection('TB'); autoLayout('TB'); }}
          variant="ghost"
          className={cn("h-6 px-2 text-[11px] font-semibold", layoutDirection === 'TB' ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:bg-muted/50")}
          title="Auto layout (Vertical)"
        >
          V
        </Button>
        <Button
          id="navbar-layout-lr"
          onClick={() => { setLayoutDirection('LR'); autoLayout('LR'); }}
          variant="ghost"
          className={cn("h-6 px-2 text-[11px] font-semibold", layoutDirection === 'LR' ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:bg-muted/50")}
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
          isConsolePanelOpen
            ? 'bg-accent text-foreground'
            : 'text-muted-foreground'
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
          isAiPanelOpen
            ? 'bg-primary/20 text-primary'
            : 'text-muted-foreground'
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
            wsConnected ? 'bg-status-done' : 'bg-status-idle',
          )}
        />
        <span className="hidden sm:inline">
          {wsConnected ? 'Connected' : 'Offline'}
        </span>
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
        {isDarkMode ? (
          <Sun size={15} weight="duotone" />
        ) : (
          <Moon size={15} weight="duotone" />
        )}
      </Button>

      {/* Run button */}
      <Button
        id="navbar-run-button"
        onClick={handleRun}
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
