import { Sparkle, X } from '@phosphor-icons/react';
import { useUiStore } from '../../store/uiStore';

export function AiPanel() {
  const setAiPanelOpen = useUiStore((s) => s.toggleAiPanel); // We need a way to close it

  return (
    <aside
      id="ai-panel"
      className="flex flex-col w-72 border-l border-border bg-background shrink-0 animate-slide-in-right"
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 h-10 border-b border-border shrink-0">
        <Sparkle size={13} weight="duotone" className="text-primary" />
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          AI Assistant
        </span>
        <span className="ml-auto text-[9px] font-medium text-muted-foreground/40 uppercase tracking-wide px-1.5 py-0.5 bg-muted/50 ">
          soon
        </span>
        <button
          onClick={() => setAiPanelOpen()}
          className="flex items-center justify-center w-5 h-5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors ml-1"
        >
          <X size={12} />
        </button>
      </div>

      {/* Body */}
      <div className="flex flex-col items-center justify-center flex-1 px-6 gap-3 text-center">
        <div className="relative">
          <div className="w-10 h-10 bg-primary/10 flex items-center justify-center">
            <Sparkle size={18} weight="duotone" className="text-primary/60" />
          </div>
          <div className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-primary/20 flex items-center justify-center">
            <div className="w-1.5 h-1.5 bg-primary/40 animate-pulse-soft" />
          </div>
        </div>
        <div className="space-y-1">
          <p className="text-xs font-medium text-foreground/80">
            AI Code Generation
          </p>
          <p className="text-[10px] text-muted-foreground/50 leading-relaxed max-w-[180px]">
            Describe what your node should do in natural language and let AI
            write the code for you.
          </p>
        </div>
      </div>
    </aside>
  );
}
