import type { Request, Response } from "express";
import { agentTokensService, type AgentScope } from "../services/agent-tokens.service.js";
import { internalError } from "../core/http-errors.js";

/** Whose tokens these are: the account asking. `authMiddleware` has run, so there is one. */
const userOf = (req: Request): string => (req as Request & { user: { id: string } }).user.id;

export const agentTokensController = {
  async issue(req: Request, res: Response) {
    try {
      const label = String(req.body?.label ?? req.body?.name ?? "").trim();
      if (!label) {
        return res.status(400).json({ error: "Label is required" });
      }

      const scopeRaw = String(req.body?.scope ?? "author").trim().toLowerCase();
      const scope: AgentScope = scopeRaw === "reader" ? "reader" : "author";

      const result = await agentTokensService.issue(userOf(req), label, scope);
      res.status(201).json(result);
    } catch (err: unknown) {
      internalError(res, err, "agent_tokens.request_failed");
    }
  },

  async list(req: Request, res: Response) {
    try {
      const tokens = await agentTokensService.list(userOf(req));
      res.status(200).json(tokens);
    } catch (err: unknown) {
      internalError(res, err, "agent_tokens.request_failed");
    }
  },

  async revoke(req: Request, res: Response) {
    try {
      const id = String(req.params.id);
      const result = await agentTokensService.revoke(id, userOf(req));
      if (!result.revoked) {
        return res.status(404).json({ error: "Agent token not found or already revoked" });
      }
      res.status(200).json({ success: true });
    } catch (err: unknown) {
      internalError(res, err, "agent_tokens.request_failed");
    }
  },
};
