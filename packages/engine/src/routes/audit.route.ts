import { Router } from "express";
import { auditController } from "../controllers/audit.controller.js";
import { authMiddleware } from "../middleware/auth.middleware.js";
import { requireRole } from "../middleware/require-role.js";

/**
 * The audit trail, read-only. There is deliberately no verb here that writes, changes or
 * deletes an event: the trail is added to by the engine and by nothing a client can call.
 *
 * `GET /` lists what the caller may see (everything for a creator; otherwise their own
 * actions and events about what they own). `GET /export` is the creator's, for a SIEM.
 */
export const auditRouter = Router();

auditRouter.use(authMiddleware);
auditRouter.get("/export", requireRole("creator"), auditController.export);
auditRouter.get("/", auditController.list);
