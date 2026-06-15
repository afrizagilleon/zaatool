import { Request, Response } from "express";
import { aiService } from "../services/ai.service.js";

export class AiController {
  async generate(req: Request, res: Response) {
    const { instruction, runtime, thisNode, upstreamNodes, model, provider, systemPrompt, skills } = req.body;

    try {
      // 1. Fetch API key
      const apiKey = await aiService.getApiKeyForProvider(provider);
      if (!apiKey) {
        return res.status(400).json({
          error: `API Key for ${provider} not found in environment or secrets.`,
        });
      }

      // 2. Call AI stream generator
      const aiResponse = await aiService.generateCodeStream(
        {
          instruction,
          runtime,
          thisNode,
          upstreamNodes,
          provider,
          model,
          systemPrompt,
          skills,
        },
        apiKey
      );

      if (!aiResponse.ok) {
        const errText = await aiResponse.text();
        return res.status(aiResponse.status).json({ error: `AI Provider error: ${errText}` });
      }

      // 3. Set SSE Headers
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

          // Forward SSE chunks: parse data: ... lines
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
              } catch (e) {
                // Ignore parsing errors for partial chunks
              }
            }
          }
        }
      }
      res.end();
    } catch (err: any) {
      console.error("AI Generation error:", err);
      if (err.cause) console.error("Cause:", err.cause);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message });
      } else {
        res.end();
      }
    }
  }
}

export const aiController = new AiController();
