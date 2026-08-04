import { Request, Response, NextFunction } from "express";
import { authService } from "../services/auth.service.js";

/**
 * Who is asking.
 *
 * Answers that question and nothing else — what they are then allowed to do is
 * {@link requireRole}'s job, one route at a time.
 *
 * The exception list used to name six paths. Four of them were the canvas's: two ran a
 * graph without a session, one read one, one checked a password. Those routes went with
 * the canvas in M17, and the holes they punched went with them.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const path = req.path;

  const isAuthRoute =
    path.startsWith("/auth/login") ||
    path.startsWith("/auth/register") ||
    // Whether the door is open at all. Public because the login screen has to be able to
    // stop offering a sign-up form that will be refused.
    path === "/auth/policy";
  const isHealthRoute = path === "/health";

  if (isAuthRoute || isHealthRoute) {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized: Missing token" });
  }

  const token = authHeader.split(" ")[1];
  const decoded = authService.verifyToken(token);

  if (!decoded) {
    return res.status(401).json({ error: "Unauthorized: Invalid or expired token" });
  }

  (req as Request & { user?: unknown }).user = decoded;
  next();
}
