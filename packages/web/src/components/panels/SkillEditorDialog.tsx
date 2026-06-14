import { useState, useRef, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import ReactMarkdown from 'react-markdown';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Sparkle, Check, X, Spinner, Lightning, BookOpen, MagicWand, Files } from '@phosphor-icons/react';
import { useUiStore } from '../../store/uiStore';
import { API_BASE_URL } from '../../lib/api';

export interface Skill {
  id: string;
  name: string;
  description: string;
  content: string;
}

interface SkillEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  skill: Skill | null;
  onSave: (skill: Skill) => void;
}

export function SkillEditorDialog({ open, onOpenChange, skill, onSave }: SkillEditorDialogProps) {
  const isDarkMode = useUiStore((s) => s.isDarkMode);
  
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [content, setContent] = useState('');
  const [viewMode, setViewMode] = useState<'edit' | 'preview'>('edit');
  
  const [isAiPanelOpen, setIsAiPanelOpen] = useState(true);
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedContent, setGeneratedContent] = useState<string | null>(null);
  const [provider, setProvider] = useState('openrouter');
  const [model, setModel] = useState('google/gemini-2.5-flash');

  const editorRef = useRef<any>(null);

  useEffect(() => {
    if (open) {
      if (skill) {
        setName(skill.name);
        setDescription(skill.description || '');
        setContent(skill.content || '');
      } else {
        setName('');
        setDescription('');
        setContent('');
      }
      setGeneratedContent(null);
      setPrompt('');
      setViewMode('edit');
    }
  }, [open, skill]);

  const monacoTheme = isDarkMode ? 'vs-dark' : 'light';

  const handleEditorChange = (value: string | undefined) => {
    setContent(value || '');
  };

  const handleSave = () => {
    onSave({
      id: skill?.id || '',
      name,
      description,
      content,
    });
  };

  const handleGenerate = async () => {
    if (!prompt) return;
    setIsGenerating(true);
    setGeneratedContent('');
    
    try {
      // Repurposing AI endpoint to generate markdown/text
      const res = await fetch(`${API_BASE_URL}/api/ai/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instruction: "Write a detailed prompt or skill for an AI agent. " + prompt,
          runtime: "text", // Custom text generation
          thisNode: {},
          upstreamNodes: [],
          provider,
          model
        })
      });

      if (!res.ok) throw new Error(await res.text());

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) return;

      let fullText = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ') && line !== 'data: [DONE]') {
            try {
              const data = JSON.parse(line.slice(6));
              fullText += data.text;
              
              let cleanedText = fullText.replace(/^```(markdown|md|text)?\n/i, '').replace(/\n```$/, '');
              setGeneratedContent(cleanedText);
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

  const acceptGeneratedContent = () => {
    if (generatedContent) {
      setContent(generatedContent);
      setGeneratedContent(null);
    }
  };

  const rejectGeneratedContent = () => {
    setGeneratedContent(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="max-w-[92vw] w-[1400px] h-[90vh] flex flex-col p-0 overflow-hidden bg-background border-border shadow-2xl"
      >
        <DialogHeader className="px-5 py-4 border-b border-border bg-muted/30 flex flex-col gap-4 shrink-0 relative">
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-primary/30 via-primary to-primary/30" />
          
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-8 h-8 bg-background border border-border shadow-sm text-foreground">
                <BookOpen size={16} weight="duotone" />
              </div>
              <div>
                <DialogTitle className="text-sm font-bold tracking-tight">
                  {skill ? 'Edit Skill' : 'Create Skill'}
                </DialogTitle>
                <DialogDescription className="text-[11px] text-muted-foreground/80 mt-0.5">
                  Define reusable instructions, personas, or context for your nodes.
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
              <Button size="sm" onClick={handleSave} className="font-bold px-5 shadow-md" disabled={!name || !content}>
                Save & Close
              </Button>
            </div>
          </div>

          <div className="flex gap-4">
             <div className="flex-1 space-y-1">
                <label className="text-[10px] uppercase font-bold text-muted-foreground">Skill Name</label>
                <Input 
                  value={name} 
                  onChange={e => setName(e.target.value)} 
                  placeholder="e.g. Code Review Persona"
                  className="h-8 bg-background font-medium shadow-sm"
                />
             </div>
             <div className="flex-[2] space-y-1">
                <label className="text-[10px] uppercase font-bold text-muted-foreground">Description</label>
                <Input 
                  value={description} 
                  onChange={e => setDescription(e.target.value)} 
                  placeholder="Brief summary of what this skill does..."
                  className="h-8 bg-background shadow-sm"
                />
             </div>
          </div>
        </DialogHeader>

        <div className="flex flex-1 overflow-hidden min-h-0 bg-background">
          {/* Main Editor */}
          <div className="flex-1 flex flex-col min-w-0 relative">
            <div className="h-10 border-b border-border flex items-center bg-muted/10 px-2 shrink-0">
               <div className="flex items-center gap-1">
                 <Button 
                   size="sm" 
                   variant="ghost" 
                   className={viewMode === 'edit' ? 'bg-background shadow-sm border border-border/50 text-foreground' : 'text-muted-foreground'}
                   onClick={() => setViewMode('edit')}
                 >
                   Edit Markdown
                 </Button>
                 <Button 
                   size="sm" 
                   variant="ghost" 
                   className={viewMode === 'preview' ? 'bg-background shadow-sm border border-border/50 text-foreground' : 'text-muted-foreground'}
                   onClick={() => setViewMode('preview')}
                 >
                   Preview
                 </Button>
               </div>
            </div>

            <div className="flex-1 relative overflow-hidden">
              {viewMode === 'edit' ? (
                <Editor
                  height="100%"
                  language="markdown"
                  theme={monacoTheme}
                  value={content}
                  onChange={handleEditorChange}
                  onMount={(editor) => {
                    editorRef.current = editor;
                  }}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 14,
                    wordWrap: 'on',
                    fontFamily: 'JetBrains Mono, Consolas, monospace',
                    padding: { top: 24, bottom: 24 },
                    scrollBeyondLastLine: false,
                    lineNumbers: 'on',
                    renderLineHighlight: 'all',
                  }}
                />
              ) : (
                <div className="w-full h-full p-8 overflow-auto prose prose-sm dark:prose-invert max-w-none bg-background">
                  <ReactMarkdown>{content}</ReactMarkdown>
                </div>
              )}
            </div>
          </div>

          {/* AI Panel */}
          {isAiPanelOpen && (
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
                        onChange={e => setModel(e.target.value)}
                        className="h-8 text-xs bg-background hover:bg-accent/50 transition-colors shadow-sm"
                        placeholder="google/gemini-2.5-flash"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] text-muted-foreground font-semibold flex items-center gap-1.5">
                      <Files size={12} /> Instructions
                    </label>
                    <textarea
                      value={prompt}
                      onChange={e => setPrompt(e.target.value)}
                      placeholder="e.g. Write a prompt that acts as a strict code reviewer checking for security flaws..."
                      className="w-full h-[100px] text-[13px] p-3 border border-border bg-background resize-none focus:ring-1 focus:ring-primary focus:border-primary outline-none shadow-inner placeholder:text-muted-foreground/30 transition-all leading-relaxed"
                    />
                    <Button 
                      className="w-full h-9 text-xs font-bold shadow-md hover:shadow-lg transition-all relative overflow-hidden group" 
                      onClick={handleGenerate}
                      disabled={isGenerating || !prompt}
                    >
                      <div className="absolute inset-0 bg-gradient-to-r from-primary/0 via-primary-foreground/10 to-primary/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000 ease-in-out" />
                      {isGenerating ? <Spinner className="animate-spin mr-2" size={14} /> : <MagicWand className="mr-2" size={14} weight="fill" />}
                      {isGenerating ? 'Generating...' : 'Generate Text'}
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
                    </div>
                    
                    <div className="flex-1 relative overflow-hidden border border-emerald-500/40 shadow-inner bg-background min-h-0">
                       <Editor
                        height="100%"
                        language="markdown"
                        theme={monacoTheme}
                        value={generatedContent}
                        options={{
                          readOnly: true,
                          minimap: { enabled: false },
                          fontSize: 12,
                          wordWrap: 'on',
                          fontFamily: 'JetBrains Mono, Consolas, monospace',
                          scrollBeyondLastLine: false,
                          padding: { top: 12, bottom: 12 },
                        }}
                      />
                    </div>
                    
                    <div className="flex gap-2 pt-1 shrink-0">
                      <Button onClick={acceptGeneratedContent} className="flex-1 bg-emerald-600 hover:bg-emerald-700 h-9 font-bold text-xs shadow-md">
                        <Check size={14} className="mr-1.5" weight="bold" /> Accept
                      </Button>
                      <Button onClick={rejectGeneratedContent} variant="outline" className="flex-1 h-9 font-bold text-xs hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30">
                        <X size={14} className="mr-1.5" weight="bold" /> Reject
                      </Button>
                    </div>
                  </div>
                )}
                {!generatedContent && !isGenerating && (
                  <div className="flex-1 flex flex-col items-center justify-center text-center p-8 gap-3 opacity-50">
                    <div className="w-12 h-12 bg-muted flex items-center justify-center rotate-3 border border-border">
                      <BookOpen size={20} className="text-muted-foreground" />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Generated text preview will appear here.
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
