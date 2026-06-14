import { Sparkle, X, Lightning, Code, MagicWand } from '@phosphor-icons/react';
import { useUiStore } from '../../store/uiStore';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Input } from '../ui/input';
import { useState } from 'react';

export function AiPanel() {
  const setAiPanelOpen = useUiStore((s) => s.toggleAiPanel);
  const [provider, setProvider] = useState('openrouter');
  const [model, setModel] = useState('google/gemini-2.5-flash');
  const [instruction, setInstruction] = useState('');

  return (
    <aside
      id="ai-panel"
      className="flex flex-col w-[320px] border-l border-border bg-background shrink-0 animate-slide-in-right shadow-2xl relative"
    >
      {/* Decorative top gradient line */}
      <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-primary/40 via-primary to-primary/40" />

      {/* Header */}
      <div className="flex items-center gap-2 px-4 h-12 border-b border-border bg-muted/20 shrink-0">
        <div className="flex items-center justify-center w-6 h-6 bg-primary/15 text-primary shadow-sm shadow-primary/20">
          <Sparkle size={14} weight="fill" />
        </div>
        <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-foreground">
          AI Assistant
        </span>
        <button
          onClick={() => setAiPanelOpen()}
          className="flex items-center justify-center w-6 h-6 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors ml-auto shadow-sm"
        >
          <X size={14} />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 flex flex-col px-5 py-6 gap-6 overflow-auto custom-scrollbar">
        
        {/* Intro */}
        <div className="text-center space-y-2">
          <h3 className="text-sm font-bold text-foreground">Code Generation</h3>
          <p className="text-[11px] text-muted-foreground/80 leading-relaxed">
            Select a node in the editor and describe what it should do. The AI will generate the code based on the input and output schema.
          </p>
        </div>

        {/* Configuration Section */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 pb-1 border-b border-border/50">
            <Lightning size={14} className="text-primary/70" weight="duotone" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Model Config</span>
          </div>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-[10px] font-medium text-foreground">Provider</label>
              <Select value={provider} onValueChange={setProvider}>
                <SelectTrigger className="h-8 text-xs bg-background/50 focus:ring-primary/50 shadow-sm transition-all hover:bg-accent/50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openrouter" className="text-xs">OpenRouter</SelectItem>
                  <SelectItem value="gemini" className="text-xs">Google Gemini</SelectItem>
                  <SelectItem value="anthropic" className="text-xs">Anthropic</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-1.5">
              <label className="text-[10px] font-medium text-foreground">Model Name</label>
              <Input 
                value={model} 
                onChange={e => setModel(e.target.value)}
                className="h-8 text-xs bg-background/50 focus:ring-primary/50 shadow-sm transition-all hover:bg-accent/50 placeholder:text-muted-foreground/30"
                placeholder="e.g. google/gemini-2.5-flash"
              />
            </div>
          </div>
        </div>

        {/* Prompt Section */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 pb-1 border-b border-border/50">
            <Code size={14} className="text-primary/70" weight="duotone" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Instructions</span>
          </div>

          <div className="space-y-2">
            <textarea
              value={instruction}
              onChange={e => setInstruction(e.target.value)}
              placeholder="e.g. Filter the array to only include even numbers..."
              className="w-full h-32 text-xs p-3 border border-border bg-background/50 resize-none focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-all shadow-inner placeholder:text-muted-foreground/40 leading-relaxed"
            />
          </div>

          <Button 
            className="w-full h-9 text-xs font-bold shadow-md hover:shadow-lg transition-all relative overflow-hidden group"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-primary/0 via-primary-foreground/10 to-primary/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000 ease-in-out" />
            <MagicWand size={14} weight="fill" className="mr-2" />
            Generate Code
          </Button>
        </div>
      </div>
    </aside>
  );
}
