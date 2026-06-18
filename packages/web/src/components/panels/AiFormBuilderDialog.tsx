import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Sparkle, Check } from '@phosphor-icons/react';
import { useAiGeneration } from '../../hooks/useAiGeneration';
import { AiGeneratorPanel } from './AiGeneratorPanel';
import type { UiInputSchema } from '@zaa-tool/shared';
import Editor from '@monaco-editor/react';
import { useUiStore } from '../../store/uiStore';

interface AiFormBuilderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nodeId: string;
  onApplySchema: (schema: Partial<UiInputSchema>) => void;
  initialSchema?: UiInputSchema;
}

export function AiFormBuilderDialog({ open, onOpenChange, nodeId, onApplySchema, initialSchema }: AiFormBuilderDialogProps) {
  const isDarkMode = useUiStore((s) => s.isDarkMode);
  const monacoTheme = isDarkMode ? 'vs-dark' : 'light';

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
    runtime: 'json',
    nodeId,
    inputsSchema: [],
    outputsSchema: [],
  });

  const [editorValue, setEditorValue] = useState<string>('');

  useEffect(() => {
    if (open) {
      setGeneratedContent(null);
      setPrompt('');
      if (initialSchema) {
        setEditorValue(JSON.stringify(initialSchema, null, 2));
      } else {
        setEditorValue(JSON.stringify({
          fields: [],
          layout: { columns: 1, triggerOn: "submit" }
        }, null, 2));
      }
    }
  }, [open, initialSchema, setGeneratedContent, setPrompt]);

  useEffect(() => {
    if (generatedContent) {
      let jsonStr = generatedContent;
      const match = generatedContent.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (match) {
        jsonStr = match[1];
      }
      setEditorValue(jsonStr.trim());
    }
  }, [generatedContent]);

  const normalizeFieldType = (type: string): 'text' | 'textarea' | 'number' | 'select' | 'radio' => {
    const t = String(type || '').toLowerCase();
    if (['select', 'dropdown', 'combobox', 'option', 'selection'].includes(t)) return 'select';
    if (['textarea', 'longtext', 'text-area', 'text_area'].includes(t)) return 'textarea';
    if (['number', 'integer', 'float', 'int'].includes(t)) return 'number';
    if (['radio', 'radiogroup', 'radio-group'].includes(t)) return 'radio';
    return 'text';
  };

  const handleApply = () => {
    if (!editorValue) return;
    try {
      const parsed = JSON.parse(editorValue);
      
      // Basic validation
      if (parsed.fields && Array.isArray(parsed.fields)) {
        const normalizedFields = parsed.fields.map((f: any) => ({
          ...f,
          type: normalizeFieldType(f.type)
        }));
        onApplySchema({
          ...parsed,
          fields: normalizedFields
        });
        onOpenChange(false);
      } else {
        alert("JSON does not contain a valid 'fields' array.");
      }
    } catch (e: any) {
      alert("Failed to parse JSON: " + e.message);
    }
  };

  const handleReject = () => {
    setGeneratedContent(null);
    if (initialSchema) {
      setEditorValue(JSON.stringify(initialSchema, null, 2));
    } else {
      setEditorValue(JSON.stringify({
        fields: [],
        layout: { columns: 1, triggerOn: "submit" }
      }, null, 2));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[85vh] flex flex-col p-0 gap-0 overflow-hidden bg-background border-border shadow-2xl">
        <DialogHeader className="px-4 py-3 border-b border-border shrink-0 bg-muted/30">
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
            <Sparkle size={16} className="text-primary" weight="duotone" />
            AI Form Builder
          </DialogTitle>
          <DialogDescription className="text-xs">
            Describe the form you want to build and AI will generate the JSON schema. You can also edit it directly.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-1 min-h-0">
          {/* AI Panel (Left) */}
          <div className="w-1/2 border-r border-border flex flex-col">
            <AiGeneratorPanel
              runtime="json"
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
              generatedContent={null}
              onGenerate={generate}
              onAccept={handleApply}
              onReject={handleReject}
              isDarkMode={false}
              placeholder="e.g. Create a login form with username, password, and remember me checkbox"
            />
          </div>

          {/* Result Preview & Editor (Right) */}
          <div className="w-1/2 flex flex-col bg-muted/10 relative">
            <div className="px-3 py-2 border-b border-border bg-muted/30 flex justify-between items-center shrink-0">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Form Schema Editor (JSON)</span>
              <Button 
                variant="ghost" 
                size="sm" 
                className="h-5 px-1.5 text-[9px] hover:bg-muted"
                onClick={() => {
                  try {
                    setEditorValue(JSON.stringify(JSON.parse(editorValue), null, 2));
                  } catch (e) {
                    alert("Cannot format: Invalid JSON");
                  }
                }}
              >
                Format
              </Button>
            </div>
            
            <div 
              className="flex-1 relative overflow-hidden bg-background"
              onKeyDown={(e) => e.stopPropagation()}
              onKeyUp={(e) => e.stopPropagation()}
            >
              <Editor
                height="100%"
                language="json"
                theme={monacoTheme}
                value={editorValue}
                onChange={(v) => setEditorValue(v || '')}
                options={{
                  minimap: { enabled: false },
                  fontSize: 12,
                  fontFamily: 'JetBrains Mono, Consolas, monospace',
                  scrollBeyondLastLine: false,
                  padding: { top: 12, bottom: 12 },
                  automaticLayout: true,
                }}
              />
            </div>
            
            <div className="p-3 border-t border-border flex justify-end gap-2 bg-muted/20 shrink-0">
              <Button variant="outline" size="sm" onClick={handleReject} className="h-8 shadow-sm">
                Reset
              </Button>
              <Button size="sm" onClick={handleApply} className="h-8 shadow-sm bg-primary hover:bg-primary/95 text-primary-foreground">
                <Check size={14} className="mr-1.5" /> Apply Form
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
