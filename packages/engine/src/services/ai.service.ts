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
    return apiKey || null;
  }

  buildPrompt(options: GenerateOptions): string {
    let prompt = `You are an expert AI coding assistant for a visual node-based engine.\n`;
    if (options.systemPrompt) prompt += `System Prompt: ${options.systemPrompt}\n`;

    if (options.skills && options.skills.length > 0) {
      prompt += `\nRelevant Skills/Context:\n${options.skills.join("\n\n")}\n`;
    }

    prompt += `\nTask: ${options.instruction}\n`;
    prompt += `Runtime: ${options.runtime} (${options.runtime === "python" ? "Python 3" : "Node.js JS/TS"})\n`;

    if (options.upstreamNodes && options.upstreamNodes.length > 0) {
      prompt += `\nUpstream Node Schemas (Data available to you):\n`;
      options.upstreamNodes.forEach((n) => {
        prompt += `- Node '${n.label}': ${JSON.stringify(n.outputsSchema)}\n`;
      });
    }

    prompt += `\nThis Node Schema:\n`;
    prompt += `- Inputs: ${JSON.stringify(options.thisNode.inputsSchema)}\n`;
    prompt += `- Outputs: ${JSON.stringify(options.thisNode.outputsSchema)}\n`;

    prompt += `\nWrite ONLY the raw code inside a markdown code block (e.g. \`\`\`javascript ... \`\`\`). Do not explain. Return the required outputs as specified. The input variables are available in the 'inputs' dictionary/object.`;
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
    } else {
      throw new Error(`Unsupported provider: ${options.provider}`);
    }
  }
}

export const aiService = new AiService();
