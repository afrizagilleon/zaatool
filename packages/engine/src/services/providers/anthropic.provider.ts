import type { AiProvider } from "./ai-provider.interface.js";

export class AnthropicProvider implements AiProvider {
  readonly name = "anthropic";

  async generate(prompt: string, model: string, apiKey: string): Promise<Response> {
    const anthropicModel = model || "claude-3-5-sonnet-latest";
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

    // Transform Anthropic SSE format → OpenAI SSE format for uniform downstream handling
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
                      choices: [{ delta: { content: parsed.delta.text } }],
                    };
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(openAiChunk)}\n\n`));
                  }
                } catch {
                  // ignore malformed SSE chunks
                }
              }
            }
          }
        } catch (err) {
          controller.error(err);
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
  }
}
