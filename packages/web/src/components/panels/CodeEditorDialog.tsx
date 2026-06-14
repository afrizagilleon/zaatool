import { useState, useRef, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Sparkle, Check, X, Spinner, Lightning, Code, MagicWand, TerminalWindow, BookOpen } from '@phosphor-icons/react';
import { useFlowStore } from '../../store/flowStore';
import { useUiStore } from '../../store/uiStore';
import { API_BASE_URL } from '../../lib/api';

interface CodeEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nodeId: string;
}

export function CodeEditorDialog({ open, onOpenChange, nodeId }: CodeEditorDialogProps) {
  const nodes = useFlowStore((s) => s.nodes);
  const updateNodeData = useFlowStore((s) => s.updateNodeData);
  const isDarkMode = useUiStore((s) => s.isDarkMode);
  const node = nodes.find((n) => n.id === nodeId);
  
  const [code, setCode] = useState(node?.data.code || '');
  const [isAiPanelOpen, setIsAiPanelOpen] = useState(true);
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [provider, setProvider] = useState('openrouter');
  const [model, setModel] = useState('google/gemini-2.5-flash');

  const [skills, setSkills] = useState<{id: string, name: string, content: string}[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);

  const editorRef = useRef<any>(null);

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/resources/skills`)
      .then(res => res.json())
      .then(data => setSkills(data))
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (open && node) {
      setCode(node.data.code || '');
      setGeneratedCode(null);
      setPrompt('');
    }
  }, [open, node]);

  if (!node) return null;

  const runtime = node.data.runtime ?? 'node';
  const language = runtime === 'python' ? 'python' : 'javascript';
  const monacoTheme = isDarkMode ? 'vs-dark' : 'light';

  const handleEditorChange = (value: string | undefined) => {
    setCode(value || '');
  };

  const handleSave = () => {
    updateNodeData(nodeId, { code });
    onOpenChange(false);
  };

  const handleGenerate = async () => {
    if (!prompt) return;
    setIsGenerating(true);
    setGeneratedCode('');
    
    try {
      let finalPrompt = prompt;
      if (selectedSkills.length > 0) {
        const skillsContent = selectedSkills
          .map(id => skills.find(s => s.id === id)?.content)
          .filter(Boolean)
          .join('\n\n---\n\n');
        finalPrompt = `${skillsContent}\n\nTask: ${prompt}`;
      }

      const res = await fetch(`${API_BASE_URL}/api/ai/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instruction: finalPrompt,
          runtime,
          thisNode: {
            inputsSchema: node.data.inputsSchema || [],
            outputsSchema: node.data.outputsSchema || []
          },
          upstreamNodes: [],
          provider,
          model
        })
      });

      if (!res.ok) throw new Error(await res.text());

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) return;

      let fullCode = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ') && line !== 'data: [DONE]') {
            try {
              const data = JSON.parse(line.slice(6));
              fullCode += data.text;
              
              let cleanedCode = fullCode.replace(/^```(javascript|python|js|ts)?\n/i, '').replace(/\n```$/, '');
              setGeneratedCode(cleanedCode);
            } catch {}
          }
        }
      }
    } catch (err: any) {
      console.error(err);
      alert('Generation failed: ' + err.message);
    } finally {
      setIsGenerating(false);
    }
  };

  const acceptGeneratedCode = () => {
    if (generatedCode) {
      setCode(generatedCode);
      setGeneratedCode(null);
    }
  };

  const rejectGeneratedCode = () => {
    setGeneratedCode(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="max-w-[92vw] w-[1400px] h-[90vh] flex flex-col p-0 overflow-hidden bg-background border-border shadow-2xl"
      >
        <DialogHeader className="px-5 py-4 border-b border-border bg-muted/30 flex flex-row items-center justify-between shrink-0 relative">
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-primary/30 via-primary to-primary/30" />
          
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 bg-background border border-border shadow-sm text-foreground">
              <TerminalWindow size={16} weight="duotone" />
            </div>
            <div>
              <DialogTitle className="text-sm font-bold tracking-tight">
                {node.data.label || 'Node Editor'} <span className="text-muted-foreground/50 font-normal">({runtime === 'python' ? 'Python' : 'JavaScript'})</span>
              </DialogTitle>
              <DialogDescription className="text-[11px] text-muted-foreground/80 mt-0.5">
                Focus on logic. Write your handler code below.
              </DialogDescription>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsAiPanelOpen(!isAiPanelOpen)}
              className={isAiPanelOpen ? 'bg-primary/10 text-primary border-primary/30 hover:bg-primary/20 shadow-inner' : 'hover:bg-accent/50'}
            >
              <Sparkle size={14} className="mr-1.5" weight="fill" />
              AI Assistant
            </Button>
            <Button size="sm" onClick={handleSave} className="font-bold px-5 shadow-md">
              Save & Close
            </Button>
          </div>
        </DialogHeader>

        <div className="flex flex-1 overflow-hidden min-h-0 bg-background">
          {/* Main Editor */}
          <div className="flex-1 flex flex-col min-w-0 relative">
            <Editor
              height="100%"
              language={language}
              theme={monacoTheme}
              value={code}
              onChange={handleEditorChange}
              onMount={(editor) => {
                editorRef.current = editor;
              }}
              options={{
                minimap: { enabled: false },
                fontSize: 14,
                fontFamily: 'JetBrains Mono, Consolas, monospace',
                padding: { top: 24, bottom: 24 },
                scrollBeyondLastLine: false,
                lineNumbers: 'on',
                renderLineHighlight: 'all',
                bracketPairColorization: { enabled: true },
                guides: { indentation: true },
              }}
            />
          </div>

          {/* AI Panel */}
          {isAiPanelOpen && (
            <div className="w-[360px] flex flex-col bg-muted/10 shrink-0 border-l border-border relative">
              <div className="p-5 border-b border-border/50 space-y-5 bg-background/50">
                <div className="flex items-center gap-2 pb-2 border-b border-border/50">
                  <Sparkle size={15} weight="fill" className="text-primary" />
                  <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-foreground">
                    Code Generation
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
                        onChange={e => setModel(e.target.value)}
                        className="h-8 text-xs bg-background hover:bg-accent/50 transition-colors shadow-sm"
                        placeholder="google/gemini-2.5-flash"
                      />
                    </div>
                  </div>

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
                        {skills.map(skill => (
                          <DropdownMenuCheckboxItem
                            key={skill.id}
                            checked={selectedSkills.includes(skill.id)}
                            onCheckedChange={(checked) => {
                              setSelectedSkills(prev => 
                                checked ? [...prev, skill.id] : prev.filter(id => id !== skill.id)
                              )
                            }}
                          >
                            {skill.name}
                          </DropdownMenuCheckboxItem>
                        ))}
                        {skills.length === 0 && <div className="p-2 text-xs text-muted-foreground text-center">No skills available</div>}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] text-muted-foreground font-semibold flex items-center gap-1.5">
                      <Code size={12} /> Instructions
                    </label>
                    <textarea
                      value={prompt}
                      onChange={e => setPrompt(e.target.value)}
                      placeholder="Describe what the code should do in natural language..."
                      className="w-full h-[100px] text-[13px] p-3 border border-border bg-background resize-none focus:ring-1 focus:ring-primary focus:border-primary outline-none shadow-inner placeholder:text-muted-foreground/30 transition-all leading-relaxed"
                    />
                    <Button 
                      className="w-full h-9 text-xs font-bold shadow-md hover:shadow-lg transition-all relative overflow-hidden group" 
                      onClick={handleGenerate}
                      disabled={isGenerating || !prompt}
                    >
                      <div className="absolute inset-0 bg-gradient-to-r from-primary/0 via-primary-foreground/10 to-primary/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000 ease-in-out" />
                      {isGenerating ? <Spinner className="animate-spin mr-2" size={14} /> : <MagicWand className="mr-2" size={14} weight="fill" />}
                      {isGenerating ? 'Generating...' : 'Generate Code'}
                    </Button>
                  </div>
                </div>
              </div>

              {/* Generated Result Preview */}
              <div className="flex-1 flex flex-col min-h-0 bg-background/30">
                {generatedCode !== null && (
                  <div className="flex flex-col h-full p-4 gap-3 animate-in fade-in slide-in-from-bottom-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-emerald-500 uppercase tracking-widest">Preview</span>
                      <span className="text-[9px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5">Diff Ready</span>
                    </div>
                    
                    <div className="flex-1 relative overflow-hidden border border-emerald-500/40 shadow-inner bg-background min-h-0">
                       <Editor
                        height="100%"
                        language={language}
                        theme={monacoTheme}
                        value={generatedCode}
                        options={{
                          readOnly: true,
                          minimap: { enabled: false },
                          fontSize: 12,
                          fontFamily: 'JetBrains Mono, Consolas, monospace',
                          scrollBeyondLastLine: false,
                          padding: { top: 12, bottom: 12 },
                        }}
                      />
                    </div>
                    
                    <div className="flex gap-2 pt-1 shrink-0">
                      <Button onClick={acceptGeneratedCode} className="flex-1 bg-emerald-600 hover:bg-emerald-700 h-9 font-bold text-xs shadow-md">
                        <Check size={14} className="mr-1.5" weight="bold" /> Accept Code
                      </Button>
                      <Button onClick={rejectGeneratedCode} variant="outline" className="flex-1 h-9 font-bold text-xs hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30">
                        <X size={14} className="mr-1.5" weight="bold" /> Reject
                      </Button>
                    </div>
                  </div>
                )}
                {!generatedCode && !isGenerating && (
                  <div className="flex-1 flex flex-col items-center justify-center text-center p-8 gap-3 opacity-50">
                    <div className="w-12 h-12 bg-muted flex items-center justify-center rotate-3 border border-border">
                      <MagicWand size={20} className="text-muted-foreground" />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Generated code preview will appear here.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
