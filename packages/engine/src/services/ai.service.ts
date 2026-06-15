import { secretsService } from "./secrets.service.js";

export interface GenerateOptions {
  instruction: string;
  runtime: string;
  thisNode: {
    inputsSchema: any[];
    outputsSchema: any[];
  };
  upstreamNodes?: {
    label: string;
    outputsSchema: any[];
  }[];
  provider: string;
  model: string;
  systemPrompt?: string;
  skills?: string[];
}

export class AiService {
  async getApiKeyForProvider(provider: string): Promise<string | null> {
    const providerKeyName =
      provider === "openrouter"
        ? "OPENROUTER_API_KEY"
        : provider === "gemini"
        ? "GEMINI_API_KEY"
        : provider === "anthropic"
        ? "ANTHROPIC_API_KEY"
        : null;

    if (!providerKeyName) return null;

    let apiKey = process.env[providerKeyName];
    if (!apiKey) {
      apiKey = (await secretsService.getValueByKey(providerKeyName)) || undefined;
    }
    return apiKey?.trim() || null;
  }

  buildPrompt(options: GenerateOptions): string {
    let prompt = `You are an expert AI coding assistant for a visual node-based engine.\n`;
    if (options.systemPrompt) prompt += `System Prompt: ${options.systemPrompt}\n`;

    if (options.skills && options.skills.length > 0) {
      prompt += `\nRelevant Skills/Context:\n${options.skills.join("\n\n")}\n`;
    }

    prompt += `\nTask: ${options.instruction}\n`;
    prompt += `Runtime: ${options.runtime} (${options.runtime === "python" ? "Python 3" : options.runtime === "json" ? "JSON Schema" : "Node.js JS/TS"})\n`;

    if (options.upstreamNodes && options.upstreamNodes.length > 0) {
      prompt += `\nUpstream Node Schemas & Connections (Data is available in the 'inputs' object):\n`;
      options.upstreamNodes.forEach((n: any) => {
        if (n.targetHandle && n.sourceHandle) {
          prompt += `- Input handle '${n.targetHandle}' is connected to Node '${n.label}' output '${n.sourceHandle}'.\n`;
          const specificOutput = Array.isArray(n.outputsSchema)
            ? n.outputsSchema.find((o: any) => o.name === n.sourceHandle)
            : null;
          prompt += `  Schema for '${n.targetHandle}': ${JSON.stringify(specificOutput || n.outputsSchema)}\n`;
        } else {
          prompt += `- Upstream Node '${n.label}': ${JSON.stringify(n.outputsSchema)}\n`;
        }
      });
    }

    prompt += `\nThis Node Schema:\n`;
    prompt += `- Inputs: ${JSON.stringify(options.thisNode.inputsSchema)}\n`;
    prompt += `- Outputs: ${JSON.stringify(options.thisNode.outputsSchema)}\n`;

    prompt += `\nData Type Guidelines:\n`;
    prompt += `- 'table': Tabular data. Must be returned as a flat array of objects (e.g. [{"id": 1, "name": "John"}, {"id": 2, "name": "Jane"}]). Do not return a stringified JSON array, return a real array of objects.\n`;
    prompt += `- 'image': A string representing an image URL or local storage path (e.g. 'uploads/image.png').\n`;
    prompt += `- 'file': An object containing file metadata, e.g. { name: string, path: string, url: string }.\n`;
    prompt += `- 'object': A dictionary/object with keys and values. For Form Inputs (ui:input), fields are grouped inside this object.\n`;

    if (options.runtime === "json") {
      prompt += `\nWrite ONLY raw, valid JSON inside a markdown code block (\`\`\`json ... \`\`\`). Do not explain. Do not wrap with extra text.\n`;
      prompt += `Important: The JSON must represent the schema for the form. It must have a 'fields' array, where each field has: 'id', 'type' (text, textarea, number, select, radio), 'label', and optional 'required' (boolean), 'placeholder', 'options' (array of {label, value} objects for select/radio).\n`;
      prompt += `Example output form schema:\n`;
      prompt += `\`\`\`json\n{\n  "fields": [\n    {"id": "name", "type": "text", "label": "Full Name", "required": true},\n    {"id": "gender", "type": "select", "label": "Gender", "options": [{"label": "Male", "value": "male"}, {"label": "Female", "value": "female"}]}\n  ],\n  "layout": {"columns": 1, "triggerOn": "submit"}\n}\n\`\`\``;
    } else {
      prompt += `\nWrite ONLY the raw code inside a markdown code block (e.g. \`\`\`javascript ... \`\`\`). Do not explain.\n`;
      prompt += `Return the outputs as a JavaScript object (e.g., \`return { outputHandleName: value };\`).\n`;
      prompt += `The input variables are properties of the 'inputs' parameter (e.g., \`inputs.inputHandleName\`).`;
    }
    return prompt;
  }

  async generateCodeStream(options: GenerateOptions, apiKey: string): Promise<Response> {
    const prompt = this.buildPrompt(options);

    if (options.provider === "openrouter") {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "http://localhost:5173",
          "X-Title": "zaa-tool",
        },
        body: JSON.stringify({
          model: options.model || "google/gemini-2.5-flash",
          messages: [{ role: "user", content: prompt }],
          stream: true,
        }),
      });
      return response;
    } else if (options.provider === "gemini") {
      let geminiModel = options.model || "gemini-2.5-flash";
      if (geminiModel.startsWith("google/")) {
        geminiModel = geminiModel.replace("google/", "");
      }
      const response = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: geminiModel,
          messages: [{ role: "user", content: prompt }],
          stream: true,
        }),
      });
      return response;
    } else if (options.provider === "anthropic") {
      const anthropicModel = options.model || "claude-3-5-sonnet-latest";
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: anthropicModel,
          messages: [{ role: "user", content: prompt }],
          max_tokens: 4096,
          stream: true,
        }),
      });

      if (!response.ok) return response;

      // Transform Anthropic SSE to OpenAI SSE
      const reader = response.body?.getReader();
      const decoder = new TextDecoder("utf-8");
      const encoder = new TextEncoder();

      const stream = new ReadableStream({
        async start(controller) {
          let buffer = "";
          try {
            while (true) {
              const { done, value } = await reader!.read();
              if (done) {
                controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                break;
              }
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n");
              buffer = lines.pop() || "";

              for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.startsWith("data: ")) {
                  try {
                    const parsed = JSON.parse(trimmed.slice(6));
                    if (parsed.type === "content_block_delta" && parsed.delta?.text) {
                      const openAiChunk = {
                        choices: [{ delta: { content: parsed.delta.text } }]
                      };
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify(openAiChunk)}\n\n`));
                    }
                  } catch {}
                }
              }
            }
          } catch (err) {
            controller.error(err);
          } finally {
            controller.close();
          }
        }
      });

      return new Response(stream, {
        headers: { "Content-Type": "text/event-stream" }
      });
    } else {
      throw new Error(`Unsupported provider: ${options.provider}`);
    }
  }
}

export const aiService = new AiService();
