import { Panel } from '@xyflow/react';
import { Button } from '../ui/button';
import { Sidebar, Terminal } from '@phosphor-icons/react';
import { cn } from '../../lib/utils';

interface CanvasToolbarProps {
  isNodePaletteOpen: boolean;
  toggleNodePalette: () => void;
  layoutDirection: string;
  setLayoutDirection: (dir: 'TB' | 'LR') => void;
  autoLayout: (dir: 'TB' | 'LR') => void;
  isConsolePanelOpen: boolean;
  toggleConsolePanel: () => void;
}

export function CanvasToolbar({
  isNodePaletteOpen,
  toggleNodePalette,
  layoutDirection,
  setLayoutDirection,
  autoLayout,
  isConsolePanelOpen,
  toggleConsolePanel,
}: CanvasToolbarProps) {
  return (
    <Panel position="top-left" className="flex items-center gap-1.5 bg-background/80 backdrop-blur-sm border border-border p-1.5 rounded-md shadow-md z-50">
      {!isNodePaletteOpen && (
        <Button
          onClick={toggleNodePalette}
          variant="ghost"
          size="icon"
          className="w-7 h-7 text-muted-foreground hover:text-foreground hover:bg-accent"
          title="Open Node Palette"
        >
          <Sidebar size={15} weight="duotone" />
        </Button>
      )}
      <div className="flex items-center bg-muted/40 p-0.5 rounded-sm">
        <Button
          onClick={() => {
            setLayoutDirection('TB');
            autoLayout('TB');
          }}
          variant="ghost"
          className={cn(
            'h-6 px-2 text-[10px] font-semibold rounded-sm',
            layoutDirection === 'TB' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:bg-muted/50'
          )}
          title="Auto layout (Vertical)"
        >
          V
        </Button>
        <Button
          onClick={() => {
            setLayoutDirection('LR');
            autoLayout('LR');
          }}
          variant="ghost"
          className={cn(
            'h-6 px-2 text-[10px] font-semibold rounded-sm',
            layoutDirection === 'LR' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:bg-muted/50'
          )}
          title="Auto layout (Horizontal)"
        >
          H
        </Button>
      </div>
      <Button
        onClick={toggleConsolePanel}
        variant="ghost"
        size="icon"
        className={cn(
          'w-7 h-7 text-muted-foreground hover:bg-accent',
          isConsolePanelOpen ? 'bg-accent text-foreground' : 'text-muted-foreground'
        )}
        title="Toggle Console"
      >
        <Terminal size={15} weight="duotone" />
      </Button>
    </Panel>
  );
}
