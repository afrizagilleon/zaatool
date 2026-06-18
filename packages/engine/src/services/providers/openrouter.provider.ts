import type { AiProvider } from "./ai-provider.interface.js";

export class OpenRouterProvider implements AiProvider {
  readonly name = "openrouter";

  async generate(prompt: string, model: string, apiKey: string): Promise<Response> {
    return fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:5173",
        "X-Title": "zaa-tool",
      },
      body: JSON.stringify({
        model: model || "google/gemini-2.5-flash",
        messages: [{ role: "user", content: prompt }],
        stream: true,
      }),
    });
  }
}
