import type { Request, Response } from "express";
import { auditReadService, AuditQueryError, type AuditFilter } from "../services/audit-read.service.js";
import { logger } from "../core/logger.js";

/** Who is asking. `authMiddleware` has run, so there is one. */
const viewerOf = (req: Request): { id: string; role: string } =>
  (req as Request & { user: { id: string; role: string } }).user;

/** A query value that is a single non-empty string, or undefined. */
function one(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function filterOf(req: Request): AuditFilter {
  return {
    action: one(req.query.action),
    actorType: one(req.query.actorType),
    targetType: one(req.query.targetType),
    targetId: one(req.query.targetId),
    outcome: one(req.query.outcome),
  };
}

function fail(res: Response, err: unknown): void {
  if (err instanceof AuditQueryError) {
    res.status(400).json({ error: err.message });
    return;
  }
  logger.error("Audit read failed", { event: "audit.read_failed", err });
  res.status(500).json({ error: "Something went wrong. Please try again." });
}

export const auditController = {
  async list(req: Request, res: Response) {
    try {
      const limit = Number(req.query.limit);
      res.json(
        await auditReadService.list(viewerOf(req), filterOf(req), {
          limit: Number.isFinite(limit) ? limit : undefined,
          before: one(req.query.before),
        })
      );
    } catch (err: unknown) {
      fail(res, err);
    }
  },

  /** JSON lines, one event per line, oldest first. The route has already limited this to creators. */
  async export(req: Request, res: Response) {
    try {
      const format = one(req.query.format) ?? "jsonl";
      if (format !== "jsonl") {
        return res.status(400).json({ error: "format must be jsonl." });
      }
      const filter = filterOf(req);
      let open = true;
      res.on("close", () => {
        open = false;
      });
      res.status(200);
      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="audit.jsonl"');
      await auditReadService.export(
        viewerOf(req),
        filter,
        (event) => {
          if (!res.write(`${JSON.stringify(event)}\n`)) {
            // Backpressure: wait for the client to catch up instead of buffering a year of events.
            return new Promise<void>((resolve) => res.once("drain", resolve));
          }
        },
        () => open
      );
      res.end();
    } catch (err: unknown) {
      if (res.headersSent) {
        // Mid-stream there is no honest status left to send; end the stream and say so in the log.
        logger.error("Audit export broke off", { event: "audit.export_failed", err });
        res.end();
        return;
      }
      fail(res, err);
    }
  },
};
