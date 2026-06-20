import { useState, useEffect } from 'react';
import { API_BASE_URL } from '../lib/api.js';
import { safeJsonStringify } from '../lib/utils.js';

export interface Skill {
  id: string;
  name: string;
  description: string;
  content: string;
}

export interface FormNodeContext {
  label: string;
  fields: { id: string; type: string; label: string }[];
}

interface UseAiGenerationProps {
  runtime: string;
  nodeId?: string;
  inputsSchema?: any[];
  outputsSchema?: any[];
  upstreamNodes?: {
    label: string;
    outputsSchema: any[];
  }[];
  formNodes?: FormNodeContext[];
}

export function useAiGeneration({ runtime, inputsSchema, outputsSchema, upstreamNodes, formNodes }: UseAiGenerationProps) {
  const [provider, setProvider] = useState('openrouter');
  const [model, setModel] = useState('google/gemini-2.5-flash');
  const [prompt, setPrompt] = useState('');
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedContent, setGeneratedContent] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/resources/skills`)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setSkills(data);
        } else {
          setSkills([]);
        }
      })
      .catch((err) => {
        console.error("Failed to load skills:", err);
        setSkills([]);
      });
  }, []);

  const generate = async (existingCode?: string | any) => {
    if (!prompt) return;
    setIsGenerating(true);
    setGeneratedContent('');

    const actualExistingCode = typeof existingCode === 'string' ? existingCode : undefined;

    try {
      let finalPrompt = prompt;
      if (selectedSkills.length > 0) {
        const skillsContent = selectedSkills
          .map((id) => skills.find((s) => s.id === id)?.content)
          .filter(Boolean)
          .join('\n\n---\n\n');
        finalPrompt = `${skillsContent}\n\nTask: ${prompt}`;
      }

      // If generating text (for skill editor), the wrapper instruction is slightly modified
      const instructionPayload = runtime === 'text'
        ? "Write a detailed prompt or skill for an AI agent. " + finalPrompt
        : finalPrompt;



      const res = await fetch(`${API_BASE_URL}/api/ai/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: safeJsonStringify({
          instruction: instructionPayload,
          runtime,
          existingCode: actualExistingCode,
          thisNode: {
            inputsSchema: inputsSchema || [],
            outputsSchema: outputsSchema || []
          },
          upstreamNodes: upstreamNodes || [],
          formNodes: formNodes || [],
          provider,
          model
        })
      });

      if (!res.ok) {
        throw new Error(await res.text());
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) return;

      let accumulatedText = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ') && line !== 'data: [DONE]') {
            try {
              const data = JSON.parse(line.slice(6));
              accumulatedText += data.text;

              let cleanedText = accumulatedText
                .replace(/^```(javascript|python|js|ts|markdown|md|text)?\n/i, '')
                .replace(/\n```$/, '');
              setGeneratedContent(cleanedText);
            } catch { }
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

  return {
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
    generate
  };
}
