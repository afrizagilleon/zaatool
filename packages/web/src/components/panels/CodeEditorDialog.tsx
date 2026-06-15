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
import { Sparkle, TerminalWindow } from '@phosphor-icons/react';
import { useFlowStore } from '../../store/flowStore';
import { useUiStore } from '../../store/uiStore';
import { useAiGeneration } from '../../hooks/useAiGeneration';
import { AiGeneratorPanel } from './AiGeneratorPanel';

interface CodeEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nodeId: string;
}

export function CodeEditorDialog({ open, onOpenChange, nodeId }: CodeEditorDialogProps) {
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);
  const updateNodeData = useFlowStore((s) => s.updateNodeData);
  const isDarkMode = useUiStore((s) => s.isDarkMode);
  const node = nodes.find((n) => n.id === nodeId);

  const [code, setCode] = useState(node?.data.code || '');
  const [isAiPanelOpen, setIsAiPanelOpen] = useState(true);
  const editorRef = useRef<any>(null);

  // Compute upstream nodes
  const upstreamEdges = edges.filter((e) => e.target === nodeId);
  const upstreamNodes = upstreamEdges
    .map((e) => {
      const sourceNode = nodes.find((n) => n.id === e.source);
      if (!sourceNode) return null;
      return {
        label: sourceNode.data.label || sourceNode.id,
        outputsSchema: sourceNode.data.inferredOutputsSchema || sourceNode.data.outputsSchema || [],
      };
    })
    .filter((n): n is { label: string; outputsSchema: any[] } => n !== null);

  const runtime = node?.data.runtime ?? 'node';
  const inputsSchema = node?.data.inputsSchema || [];
  const outputsSchema = node?.data.outputsSchema || [];

  // Initialize custom hook
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
    runtime,
    nodeId,
    inputsSchema,
    outputsSchema,
    upstreamNodes,
  });

  useEffect(() => {
    if (open && node) {
      setCode(node.data.code || '');
      setGeneratedContent(null);
      setPrompt('');
    }
  }, [open, node, setGeneratedContent, setPrompt]);

  if (!node) return null;

  const language = runtime === 'python' ? 'python' : 'javascript';
  const monacoTheme = isDarkMode ? 'vs-dark' : 'light';

  const handleEditorChange = (value: string | undefined) => {
    setCode(value || '');
  };

  const handleSave = () => {
    updateNodeData(nodeId, { code });
    onOpenChange(false);
  };

  const acceptGeneratedCode = () => {
    if (generatedContent) {
      setCode(generatedContent);
      setGeneratedContent(null);
    }
  };

  const rejectGeneratedCode = () => {
    setGeneratedContent(null);
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
                {node.data.label || 'Node Editor'}{' '}
                <span className="text-muted-foreground/50 font-normal">
                  ({runtime === 'python' ? 'Python' : 'JavaScript'})
                </span>
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
              className={
                isAiPanelOpen
                  ? 'bg-primary/10 text-primary border-primary/30 hover:bg-primary/20 shadow-inner'
                  : 'hover:bg-accent/50'
              }
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
            <AiGeneratorPanel
              runtime={runtime}
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
              onAccept={acceptGeneratedCode}
              onReject={rejectGeneratedCode}
              isDarkMode={isDarkMode}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
