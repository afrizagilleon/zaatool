import { Button } from '../ui/button.js';
import { Layout, FloppyDisk, ArrowSquareOut } from '@phosphor-icons/react';

interface DashboardBuilderToolbarProps {
  dashboardPassword: string;
  setDashboardPassword: (value: string) => void;
  shareUrl: string;
  copied: boolean;
  isSaving: boolean;
  onCopyUrl: () => void;
  onSaveLayout: () => void;
  onLaunchApp: () => void;
}

export function DashboardBuilderToolbar({
  dashboardPassword,
  setDashboardPassword,
  shareUrl,
  copied,
  isSaving,
  onCopyUrl,
  onSaveLayout,
  onLaunchApp,
}: DashboardBuilderToolbarProps) {
  return (
    <div className="h-14 border-b border-border px-6 flex items-center justify-between bg-card/60 backdrop-blur shrink-0 text-foreground">
      <div className="flex items-center gap-2">
        <Layout className="w-5 h-5 text-primary" />
        <h1 className="text-sm font-bold uppercase tracking-wider">Dashboard Grid Builder</h1>
        <span className="text-[10px] text-muted-foreground font-mono">Arrange and resize widgets</span>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center bg-muted border border-border rounded-lg px-3 py-1 text-xs gap-2">
          <span className="text-muted-foreground font-mono">Password:</span>
          <input
            type="password"
            placeholder="Set password (optional)"
            value={dashboardPassword}
            onChange={(e) => setDashboardPassword(e.target.value)}
            className="bg-background border border-border rounded px-2 py-0.5 text-xs w-36 outline-none focus:border-primary text-foreground font-mono"
          />
          {dashboardPassword && (
            <button
              onClick={() => setDashboardPassword('')}
              className="text-[10px] text-red-500 font-bold hover:underline shrink-0"
            >
              Clear
            </button>
          )}
        </div>

        <div className="flex items-center bg-muted border border-border rounded-lg px-3 py-1 text-xs">
          <span className="text-muted-foreground mr-2 font-mono">Public URL:</span>
          <span className="text-foreground font-mono select-all truncate max-w-[240px]">{shareUrl}</span>
          <button
            onClick={onCopyUrl}
            className="ml-3 font-semibold text-foreground hover:text-primary transition-colors cursor-pointer shrink-0"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>

        <Button
          size="sm"
          variant="outline"
          className="border-border hover:bg-muted text-xs h-8 flex items-center gap-1.5"
          onClick={onLaunchApp}
        >
          <ArrowSquareOut className="w-4 h-4" />
          Launch App
        </Button>

        <Button
          size="sm"
          className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-xs h-8 flex items-center gap-1.5"
          disabled={isSaving}
          onClick={onSaveLayout}
        >
          <FloppyDisk className="w-4 h-4" />
          {isSaving ? 'Saving...' : 'Save Layout'}
        </Button>
      </div>
    </div>
  );
}
