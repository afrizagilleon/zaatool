import { Router } from "express";
import { agentTokensController } from "../controllers/agent-tokens.controller.js";
import { authMiddleware } from "../middleware/auth.middleware.js";
import { requireRole } from "../middleware/require-role.js";

export const agentTokensRouter = Router();

agentTokensRouter.use(authMiddleware);
agentTokensRouter.use(requireRole("creator"));

agentTokensRouter.post("/", agentTokensController.issue);
agentTokensRouter.get("/", agentTokensController.list);
agentTokensRouter.delete("/:id", agentTokensController.revoke);
