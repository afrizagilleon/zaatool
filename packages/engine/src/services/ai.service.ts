import { secretsService } from "./secrets.service.js";
import { aiPromptService } from "./ai-prompt.service.js";
import { OpenRouterProvider } from "./providers/openrouter.provider.js";
import { GeminiProvider } from "./providers/gemini.provider.js";
import { AnthropicProvider } from "./providers/anthropic.provider.js";
import type { AiProvider } from "./providers/ai-provider.interface.js";

export interface GenerateOptions {
  instruction: string;
  runtime: string;
  thisNode: {
    inputsSchema: unknown[];
    outputsSchema: unknown[];
  };
  upstreamNodes?: Record<string, unknown>[];
  provider: string;
  model: string;
  systemPrompt?: string;
  skills?: string[];
  existingCode?: string;
}

export class AiService {
  private readonly providers: Map<string, AiProvider> = new Map<string, AiProvider>([
    ["openrouter", new OpenRouterProvider()],
    ["gemini", new GeminiProvider()],
    ["anthropic", new AnthropicProvider()],
  ]);

  async getApiKeyForProvider(provider: string): Promise<string | null> {
    const keyNames: Record<string, string> = {
      openrouter: "OPENROUTER_API_KEY",
      gemini: "GEMINI_API_KEY",
      anthropic: "ANTHROPIC_API_KEY",
    };

    const providerKeyName = keyNames[provider];
    if (!providerKeyName) return null;

    let apiKey = process.env[providerKeyName];
    if (!apiKey) {
      apiKey = (await secretsService.getValueByKey(providerKeyName)) || undefined;
    }
    return apiKey?.trim() || null;
  }

  async generate(options: GenerateOptions, apiKey: string): Promise<Response> {
    const provider = this.providers.get(options.provider);
    if (!provider) {
      throw new Error(`Unsupported AI provider: ${options.provider}`);
    }
    const prompt = aiPromptService.build(options);
    return provider.generate(prompt, options.model, apiKey);
  }
}

export const aiService = new AiService();
