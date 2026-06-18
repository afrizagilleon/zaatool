import Editor from '@monaco-editor/react';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Sparkle, Check, X, Spinner, Lightning, Code, MagicWand, BookOpen, Files } from '@phosphor-icons/react';

export interface Skill {
  id: string;
  name: string;
  description: string;
  content: string;
}

interface AiGeneratorPanelProps {
  runtime: string;
  provider: string;
  setProvider: (p: string) => void;
  model: string;
  setModel: (m: string) => void;
  prompt: string;
  setPrompt: (p: string) => void;
  selectedSkills: string[];
  setSelectedSkills: (s: string[]) => void;
  skills: Skill[];
  isGenerating: boolean;
  generatedContent: string | null;
  onGenerate: () => void;
  onAccept: () => void;
  onReject: () => void;
  isDarkMode: boolean;
  placeholder?: string;
}

export function AiGeneratorPanel({
  runtime,
  provider,
  setProvider,
  model,
  setModel,
  prompt,
  setPrompt,
  selectedSkills,
  setSelectedSkills,
  skills,
  isGenerating,
  generatedContent,
  onGenerate,
  onAccept,
  onReject,
  isDarkMode,
  placeholder,
}: AiGeneratorPanelProps) {
  const language = runtime === 'python' ? 'python' : runtime === 'text' ? 'markdown' : 'javascript';
  const monacoTheme = isDarkMode ? 'vs-dark' : 'light';

  return (
    <div className="w-[360px] flex flex-col bg-muted/10 shrink-0 border-l border-border relative">
      <div className="p-5 border-b border-border/50 space-y-5 bg-background/50">
        <div className="flex items-center gap-2 pb-2 border-b border-border/50">
          <Sparkle size={15} weight="fill" className="text-primary" />
          <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-foreground">
            Content Generation
          </span>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[10px] text-muted-foreground font-semibold flex items-center gap-1.5">
                <Lightning size={12} /> Provider
              </label>
              <Select value={provider} onValueChange={setProvider}>
                <SelectTrigger className="h-8 text-xs bg-background hover:bg-accent/50 transition-colors shadow-sm">
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
              <label className="text-[10px] text-muted-foreground font-semibold flex items-center gap-1.5">
                Model Name
              </label>
              <Input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="h-8 text-xs bg-background hover:bg-accent/50 transition-colors shadow-sm"
                placeholder="google/gemini-2.5-flash"
              />
            </div>
          </div>

          {/* Show skills selection dropdown only for non-text runtimes (e.g. JS/Python editor) */}
          {runtime !== 'text' && (
            <div className="space-y-1.5">
              <label className="text-[10px] text-muted-foreground font-semibold flex items-center gap-1.5">
                <BookOpen size={12} /> Use Custom Skills
              </label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="w-full justify-start h-8 text-xs font-normal bg-background hover:bg-accent/50 shadow-sm px-3">
                    {selectedSkills.length === 0 ? "Select skills..." : `${selectedSkills.length} selected`}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-64">
                  <DropdownMenuLabel>Custom Skills</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {Array.isArray(skills) && skills.map((skill) => (
                    <DropdownMenuCheckboxItem
                      key={skill.id}
                      checked={selectedSkills.includes(skill.id)}
                      onCheckedChange={(checked) => {
                        setSelectedSkills(
                          checked
                            ? [...selectedSkills, skill.id]
                            : selectedSkills.filter((id) => id !== skill.id)
                        );
                      }}
                    >
                      {skill.name}
                    </DropdownMenuCheckboxItem>
                  ))}
                  {(!Array.isArray(skills) || skills.length === 0) && (
                    <div className="p-2 text-xs text-muted-foreground text-center">No skills available</div>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-[10px] text-muted-foreground font-semibold flex items-center gap-1.5">
              {runtime === 'text' ? <Files size={12} /> : <Code size={12} />} Instructions
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={placeholder || (runtime === 'text' ? "e.g. Write a prompt that reviewer checks for security flaws..." : "Describe what the code should do in natural language...")}
              className="w-full h-[100px] text-[13px] p-3 border border-border bg-background resize-none focus:ring-1 focus:ring-primary focus:border-primary outline-none shadow-inner placeholder:text-muted-foreground/30 transition-all leading-relaxed"
            />
            <Button
              className="w-full h-9 text-xs font-bold shadow-md hover:shadow-lg transition-all relative overflow-hidden group"
              onClick={() => onGenerate()}
              disabled={isGenerating || !prompt}
            >
              <div className="absolute inset-0 bg-gradient-to-r from-primary/0 via-primary-foreground/10 to-primary/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000 ease-in-out" />
              {isGenerating ? (
                <Spinner className="animate-spin mr-2" size={14} />
              ) : (
                <MagicWand className="mr-2" size={14} weight="fill" />
              )}
              {isGenerating ? 'Generating...' : runtime === 'text' ? 'Generate Text' : 'Generate Code'}
            </Button>
          </div>
        </div>
      </div>

      {/* Generated Result Preview */}
      <div className="flex-1 flex flex-col min-h-0 bg-background/30">
        {generatedContent !== null && (
          <div className="flex flex-col h-full p-4 gap-3 animate-in fade-in slide-in-from-bottom-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-emerald-500 uppercase tracking-widest">Preview</span>
              {runtime !== 'text' && <span className="text-[9px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5">Diff Ready</span>}
            </div>

            <div 
              className="flex-1 relative overflow-hidden border border-emerald-500/40 shadow-inner bg-background min-h-0"
              onKeyDown={(e) => e.stopPropagation()}
              onKeyUp={(e) => e.stopPropagation()}
            >
              <Editor
                height="100%"
                language={language}
                theme={monacoTheme}
                value={generatedContent}
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  fontSize: 12,
                  wordWrap: runtime === 'text' ? 'on' : 'off',
                  fontFamily: 'JetBrains Mono, Consolas, monospace',
                  scrollBeyondLastLine: false,
                  padding: { top: 12, bottom: 12 },
                }}
              />
            </div>

            <div className="flex gap-2 pt-1 shrink-0">
              <Button onClick={onAccept} className="flex-1 bg-emerald-600 hover:bg-emerald-700 h-9 font-bold text-xs shadow-md">
                <Check size={14} className="mr-1.5" weight="bold" /> Accept
              </Button>
              <Button onClick={onReject} variant="outline" className="flex-1 h-9 font-bold text-xs hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30">
                <X size={14} className="mr-1.5" weight="bold" /> Reject
              </Button>
            </div>
          </div>
        )}
        {!generatedContent && !isGenerating && (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8 gap-3 opacity-50">
            <div className="w-12 h-12 bg-muted flex items-center justify-center rotate-3 border border-border">
              {runtime === 'text' ? (
                <BookOpen size={20} className="text-muted-foreground" />
              ) : (
                <MagicWand size={20} className="text-muted-foreground" />
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Generated preview will appear here.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
