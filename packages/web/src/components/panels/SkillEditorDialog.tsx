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
import { Sparkle, BookOpen } from '@phosphor-icons/react';
import { useUiStore } from '../../store/uiStore';
import { useAiGeneration } from '../../hooks/useAiGeneration';
import { AiGeneratorPanel } from './AiGeneratorPanel';

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

  const editorRef = useRef<any>(null);

  // Initialize Custom Hook for AI Generation
  const {
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
    setGeneratedContent,
    generate,
  } = useAiGeneration({
    runtime: 'text', // Generates text content
  });

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
  }, [open, skill, setGeneratedContent, setPrompt]);

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
                className={
                  isAiPanelOpen
                    ? 'bg-primary/10 text-primary border-primary/30 hover:bg-primary/20 shadow-inner'
                    : 'hover:bg-accent/50'
                }
              >
                <Sparkle size={14} className="mr-1.5" weight="fill" />
                AI Assistant
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                className="font-bold px-5 shadow-md"
                disabled={!name || !content}
              >
                Save & Close
              </Button>
            </div>
          </div>

          <div className="flex gap-4">
            <div className="flex-1 space-y-1">
              <label className="text-[10px] uppercase font-bold text-muted-foreground">Skill Name</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Code Review Persona"
                className="h-8 bg-background font-medium shadow-sm"
              />
            </div>
            <div className="flex-[2] space-y-1">
              <label className="text-[10px] uppercase font-bold text-muted-foreground">Description</label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
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
                  className={
                    viewMode === 'edit'
                      ? 'bg-background shadow-sm border border-border/50 text-foreground'
                      : 'text-muted-foreground'
                  }
                  onClick={() => setViewMode('edit')}
                >
                  Edit Markdown
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className={
                    viewMode === 'preview'
                      ? 'bg-background shadow-sm border border-border/50 text-foreground'
                      : 'text-muted-foreground'
                  }
                  onClick={() => setViewMode('preview')}
                >
                  Preview
                </Button>
              </div>
            </div>

            <div 
              className="flex-1 relative overflow-hidden"
              onKeyDown={(e) => e.stopPropagation()}
              onKeyUp={(e) => e.stopPropagation()}
            >
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
            <AiGeneratorPanel
              runtime="text"
              provider={provider}
              setProvider={setProvider}
              model={model}
              setModel={setModel}
              prompt={prompt}
              setPrompt={setPrompt}
              selectedSkills={selectedSkills}
              setSelectedSkills={setSelectedSkills}
              skills={skills}
              isGenerating={isGenerating}
              generatedContent={generatedContent}
              onGenerate={generate}
              onAccept={acceptGeneratedContent}
              onReject={rejectGeneratedContent}
              isDarkMode={isDarkMode}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
