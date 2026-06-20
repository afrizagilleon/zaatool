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
import { useAiGeneration, type FormNodeContext } from '../../hooks/useAiGeneration';
import { AiGeneratorPanel } from './AiGeneratorPanel';
import type { UiInputField } from '@zaa-tool/shared';

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

  console.log("[CodeEditorDialog] Render, open:", open, "nodeId:", nodeId, "foundNode:", !!node);

  const [code, setCode] = useState(node?.data.code || '');
  const [runCondition, setRunCondition] = useState(node?.data.runCondition || '');
  const [isAiPanelOpen, setIsAiPanelOpen] = useState(true);
  const [isReferenceOpen, setIsReferenceOpen] = useState(false);
  const editorRef = useRef<any>(null);

  // Compute upstream nodes (via edges)
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

  // Compute form context: all ui:input nodes in the flow, available as inputs.form
  const formNodes: FormNodeContext[] = nodes
    .filter((n) => n.type === 'ui:input')
    .map((n) => ({
      label: n.data.label || n.id,
      fields: (n.data.uiSchema?.fields ?? []).map((f: UiInputField) => ({
        id: f.id,
        type: f.type,
        label: f.label,
      })),
    }));

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
    formNodes,
  });

  useEffect(() => {
    if (open && node) {
      setCode(node.data.code || '');
      setRunCondition(node.data.runCondition || '');
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
    updateNodeData(nodeId, { code, runCondition: runCondition.trim() || undefined });
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
              onClick={() => setIsReferenceOpen(!isReferenceOpen)}
              className={
                isReferenceOpen
                  ? 'bg-primary/10 text-primary border-primary/30 hover:bg-primary/20 shadow-inner'
                  : 'hover:bg-accent/50'
              }
            >
              <TerminalWindow size={14} className="mr-1.5" weight="fill" />
              API Guide
            </Button>
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

        {/* Run Condition bar */}
        <div className="shrink-0 px-5 py-2 border-b border-border bg-muted/10 flex items-center gap-3">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 shrink-0">
            Run Condition
          </span>
          <div className="flex-1 relative">
            <input
              type="text"
              value={runCondition}
              onChange={(e) => setRunCondition(e.target.value)}
              placeholder="e.g. inputs.form.freq === 'per week'   |   inputs.is_selected && inputs.form.date !== null"
              className="w-full h-7 px-3 font-mono text-[11px] bg-background border border-border rounded focus:outline-none focus:border-primary text-foreground placeholder:text-muted-foreground/30"
            />
          </div>
          {runCondition.trim() && (
            <span className="shrink-0 text-[9px] font-semibold px-2 py-0.5 rounded bg-amber-500/10 text-amber-500 border border-amber-500/20 uppercase tracking-wider">
              Conditional
            </span>
          )}
          {!runCondition.trim() && (
            <span className="shrink-0 text-[9px] text-muted-foreground/30 uppercase tracking-wider">
              Always runs
            </span>
          )}
        </div>

        <div className="flex flex-1 overflow-hidden min-h-0 bg-background">
          {/* Reference Sidebar */}
          {isReferenceOpen && (
            <div className="w-[320px] border-r border-border bg-muted/10 flex flex-col overflow-y-auto shrink-0 select-none">
              <div className="p-4 border-b border-border bg-muted/20">
                <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">API Reference</h3>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Access inputs, credentials, and shape outputs using helper classes.
                </p>
              </div>
              
              <div className="p-4 space-y-5">

                {/* Inputs Section */}
                <div className="space-y-2">
                  <h4 className="text-[11px] font-bold text-foreground/80 uppercase tracking-widest">Wired Inputs</h4>
                  {inputsSchema.length === 0 ? (
                    <div className="text-[10px] text-muted-foreground/60 italic">No inputs defined.</div>
                  ) : (
                    <div className="space-y-1.5">
                      {inputsSchema.map((field: any, idx: number) => (
                        <div key={idx} className="p-2 bg-muted/40 border border-border/60 rounded">
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-[11px] font-bold text-primary">{field.name}</span>
                            <span className="text-[9px] uppercase font-semibold text-muted-foreground/80 bg-muted px-1.5 py-0.5 rounded">{field.type}</span>
                          </div>
                          <div className="mt-1 font-mono text-[10px] text-foreground/60">
                            {language === 'javascript' ? `inputs.${field.name}` : `inputs['${field.name}']`}
                            {field.type === 'table' && <span className="ml-2 text-primary/60">{language === 'javascript' ? '// .getRows() .getColumn() .count() .filter()' : '# .get_rows() .get_column() .count() .filter()'}</span>}
                            {field.type === 'file' && <span className="ml-2 text-primary/60">{language === 'javascript' ? '// .readAsText() .readAsBuffer() .exists()' : '# .read_as_text() .exists()'}</span>}
                            {field.type === 'image' && <span className="ml-2 text-primary/60">{language === 'javascript' ? '// .toDataUri() .readAsBase64()' : '# .to_data_uri() .read_as_base64()'}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Form Context Section */}
                {formNodes.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-[11px] font-bold text-foreground/80 uppercase tracking-widest">Form Context</h4>
                    <div className="p-2 bg-amber-500/5 border border-amber-500/20 rounded text-[10px] space-y-2">
                      <p className="text-muted-foreground/80">
                        All Input Form values — accessible anywhere via <span className="font-mono text-amber-500">inputs.form</span>, no edge needed.
                      </p>
                      {formNodes.map((form) => (
                        <div key={form.label} className="space-y-1 border-t border-border/30 pt-2">
                          <div className="font-semibold text-foreground/60 text-[10px]">{form.label}</div>
                          {form.fields.length === 0 ? (
                            <div className="text-muted-foreground/40 italic">No fields yet.</div>
                          ) : (
                            <div className="font-mono space-y-0.5">
                              {form.fields.map((f) => (
                                <div key={f.id} className="flex items-center gap-2">
                                  <span className="text-amber-500">{f.id}</span>
                                  <span className="text-muted-foreground/40 text-[9px]">{f.type}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                      {formNodes.length > 1 && (
                        <p className="text-[9px] text-muted-foreground/60 border-t border-amber-500/20 pt-1.5">
                          Multiple forms: <span className="font-mono text-amber-500">inputs.form.__nodes["Label"].fieldId</span>
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Run Condition */}
                <div className="space-y-2">
                  <h4 className="text-[11px] font-bold text-foreground/80 uppercase tracking-widest">Run Condition</h4>
                  <div className="p-2 bg-muted/40 border border-border/60 rounded text-[10px] space-y-1.5">
                    <p className="text-muted-foreground/80">JS expression in the bar above. If <span className="font-mono">false</span>, node is skipped and outputs <span className="font-mono">null</span>. Has full access to <span className="font-mono">inputs</span> and <span className="font-mono">inputs.form</span>.</p>
                    <div className="font-mono text-foreground/60 space-y-0.5 border-t border-border/40 pt-1.5 text-[10px]">
                      <div className="text-muted-foreground/40">// single</div>
                      <div>inputs.form.field === 'value'</div>
                      <div className="text-muted-foreground/40 mt-1">// compound</div>
                      <div>inputs.form.a !== null &amp;&amp; inputs.b</div>
                    </div>
                  </div>
                </div>

                {/* Outputs Section */}
                <div className="space-y-2">
                  <h4 className="text-[11px] font-bold text-foreground/80 uppercase tracking-widest">Outputs</h4>
                  {outputsSchema.length === 0 ? (
                    <div className="text-[10px] text-muted-foreground/60 italic">No outputs schema defined.</div>
                  ) : (
                    <div className="p-2 bg-muted/40 border border-border/60 rounded text-[10px] space-y-1.5">
                      <p className="text-muted-foreground/80">Return an object matching the schema:</p>
                      <div className="font-mono text-foreground/70 space-y-0.5">
                        {language === 'javascript' ? (
                          <>
                            <div>return &#123;</div>
                            {outputsSchema.map((field: any, idx: number) => (
                              <div key={idx} className="pl-3 text-foreground/60">
                                {field.name}: <span className="text-muted-foreground/50">{field.type === 'string' ? '"..."' : field.type === 'number' ? '0' : field.type === 'boolean' ? 'true' : field.type === 'table' ? '[]' : '{}'}</span>,
                              </div>
                            ))}
                            <div>&#125;;</div>
                          </>
                        ) : (
                          <>
                            <div>return &#123;</div>
                            {outputsSchema.map((field: any, idx: number) => (
                              <div key={idx} className="pl-3 text-foreground/60">
                                "{field.name}": <span className="text-muted-foreground/50">{field.type === 'string' ? '"..."' : field.type === 'number' ? '0' : field.type === 'boolean' ? 'True' : field.type === 'table' ? '[]' : '{}'}</span>,
                              </div>
                            ))}
                            <div>&#125;</div>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Secrets Section */}
                <div className="space-y-2">
                  <h4 className="text-[11px] font-bold text-foreground/80 uppercase tracking-widest">Secrets</h4>
                  <div className="p-2 bg-muted/40 border border-border/60 rounded text-[10px] space-y-1">
                    <p className="text-muted-foreground/80">Injected as environment variables.</p>
                    <div className="font-mono text-foreground/60">
                      {language === 'javascript' ? 'process.env.MY_SECRET' : 'os.environ.get("MY_SECRET")'}
                    </div>
                  </div>
                </div>

              </div>
            </div>
          )}

          {/* Main Editor */}
          <div 
            className="flex-1 flex flex-col min-w-0 relative"
            onKeyDown={(e) => e.stopPropagation()}
            onKeyUp={(e) => e.stopPropagation()}
          >
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
              onGenerate={() => generate(code)}
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
