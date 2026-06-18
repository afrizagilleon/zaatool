import type { AiProvider } from "./ai-provider.interface.js";

export class GeminiProvider implements AiProvider {
  readonly name = "gemini";

  async generate(prompt: string, model: string, apiKey: string): Promise<Response> {
    let geminiModel = model || "gemini-2.5-flash";
    if (geminiModel.startsWith("google/")) {
      geminiModel = geminiModel.replace("google/", "");
    }

    return fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
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
  }
}
