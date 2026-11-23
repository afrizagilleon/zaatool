import type { Request, Response, NextFunction } from "express";
import type { Role } from "../services/auth.service.js";
import { audit } from "../services/audit.service.js";

/**
 * The check that was missing.
 *
 * `users.role` has existed for a long time, has been written into every JWT this engine
 * ever signed, and was read by nothing — which meant an account created as `viewer` could
 * write notebooks, deploy them, read secrets and upload files. The column was a label,
 * not a permission.
 *
 * Written per route rather than as one table of patterns somewhere central, because a
 * route added later inherits nothing: whoever adds it has to say what it needs. A
 * forgotten guard is then visible in the route file, where it is missing, rather than
 * invisible in a list nobody thought to open.
 *
 * Runs after {@link authMiddleware}, which is what puts `req.user` there.
 */
export function requireRole(...allowed: Role[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = (req as Request & { user?: { role?: string } }).user;

    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!allowed.includes(user.role as Role)) {
      // The route's template (`/api/agent-tokens/:id`), not the URL: ids stay out of it.
      await audit.record({
        action: "authz.denied",
        outcome: "denied",
        meta: {
          required: allowed,
          role: user.role ?? "unknown",
          method: req.method,
          route: `${req.baseUrl}${req.route?.path ?? ""}`,
        },
      });
      return res.status(403).json({
        error: `This needs a ${allowed.join(" or ")} account. Yours is ${user.role ?? "unknown"}.`,
      });
    }

    next();
  };
}
