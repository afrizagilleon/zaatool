import { Router } from "express";
import { pool } from "../db/database.js";

const router = Router();

router.post("/generate", async (req, res) => {
  const { instruction, runtime, thisNode, upstreamNodes, model, provider, systemPrompt, skills } = req.body;

  try {
    // 1. Find API key for the chosen provider from secrets
    const providerKeyName = provider === 'openrouter' ? 'OPENROUTER_API_KEY' : 
                            provider === 'gemini' ? 'GEMINI_API_KEY' : 
                            provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : null;

    let apiKey = process.env[providerKeyName || ''];
    if (!apiKey && providerKeyName) {
      const { rows } = await pool.query("SELECT value FROM secrets WHERE key = $1", [providerKeyName]);
      if (rows.length > 0) apiKey = rows[0].value;
    }

    if (!apiKey) {
      return res.status(400).json({ error: `API Key for ${provider} not found in environment or secrets (${providerKeyName}).` });
    }

    // 2. Construct the prompt
    let prompt = `You are an expert AI coding assistant for a visual node-based engine.\n`;
    if (systemPrompt) prompt += `System Prompt: ${systemPrompt}\n`;
    
    if (skills && skills.length > 0) {
      prompt += `\nRelevant Skills/Context:\n${skills.join("\n\n")}\n`;
    }

    prompt += `\nTask: ${instruction}\n`;
    prompt += `Runtime: ${runtime} (${runtime === 'python' ? 'Python 3' : 'Node.js JS/TS'})\n`;
    
    prompt += `\nUpstream Node Schemas (Data available to you):\n`;
    upstreamNodes.forEach((n: any) => {
      prompt += `- Node '${n.label}': ${JSON.stringify(n.outputsSchema)}\n`;
    });

    prompt += `\nThis Node Schema:\n`;
    prompt += `- Inputs: ${JSON.stringify(thisNode.inputsSchema)}\n`;
    prompt += `- Outputs: ${JSON.stringify(thisNode.outputsSchema)}\n`;

    prompt += `\nWrite ONLY the raw code inside a markdown code block (e.g. \`\`\`javascript ... \`\`\`). Do not explain. Return the required outputs as specified. The input variables are available in the 'inputs' dictionary/object.`;

    // 3. Call the API (Currently OpenRouter placeholder)
    // For MVP, we will do a simple fetch to OpenRouter
    if (provider === 'openrouter') {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "http://localhost:5173", // Optional
          "X-Title": "zaa-tool", // Optional
        },
        body: JSON.stringify({
          model: model || "google/gemini-2.5-flash",
          messages: [{ role: "user", content: prompt }],
          stream: true,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        return res.status(response.status).json({ error: `OpenRouter error: ${errText}` });
      }

      // Stream the response back to client using SSE
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const reader = response.body?.getReader();
      const decoder = new TextDecoder("utf-8");

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          
          // OpenRouter sends SSE chunks like `data: {...}`
          // We can parse and forward them
          const lines = chunk.split("\n").filter(line => line.trim() !== "");
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
    } else {
      res.status(400).json({ error: "Unsupported provider" });
    }

  } catch (err: any) {
    console.error("AI Generation error:", err);
    res.status(500).json({ error: err.message });
  }
});

export const aiRouter = router;
