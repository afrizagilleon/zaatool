import { Request, Response } from "express";
import { aiService } from "../services/ai.service.js";

export class AiController {
  async generate(req: Request, res: Response) {
    const { instruction, runtime, thisNode, upstreamNodes, model, provider, systemPrompt, skills, existingCode } =
      req.body;

    try {
      const apiKey = await aiService.getApiKeyForProvider(provider);
      if (!apiKey) {
        return res.status(400).json({
          error: `API Key for ${provider} not found in environment or secrets.`,
        });
      }

      const aiResponse = await aiService.generate(
        { instruction, runtime, thisNode, upstreamNodes, provider, model, systemPrompt, skills, existingCode },
        apiKey
      );

      if (!aiResponse.ok) {
        const errText = await aiResponse.text();
        return res.status(aiResponse.status).json({ error: `AI Provider error: ${errText}` });
      }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const reader = aiResponse.body?.getReader();
      const decoder = new TextDecoder("utf-8");

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });

          const lines = chunk.split("\n").filter((line) => line.trim() !== "");
          for (const line of lines) {
            if (line === "data: [DONE]") {
              res.write("data: [DONE]\n\n");
            } else if (line.startsWith("data: ")) {
              try {
                const parsed = JSON.parse(line.slice(6));
                const text = parsed.choices?.[0]?.delta?.content || "";
                if (text) {
                  res.write(`data: ${JSON.stringify({ text })}\n\n`);
                }
              } catch {
                // ignore partial chunks
              }
            }
          }
        }
      }
      res.end();
    } catch (err: unknown) {
      const error = err as Error;
      if (!res.headersSent) {
        res.status(500).json({ error: error.message });
      } else {
        res.end();
      }
    }
  }
}

export const aiController = new AiController();
