import { Request, Response, NextFunction } from "express";
import { authService } from "../services/auth.service.js";
import { credentialOf } from "./session-cookie.js";
import { setActor } from "../core/request-context.js";

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
export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const path = req.path;

  const isAuthRoute =
    path.startsWith("/auth/login") ||
    path.startsWith("/auth/register") ||
    // Clearing a cookie needs no proof of who you are, and a browser whose session already
    // ended should still be able to get rid of the cookie it is holding.
    path === "/auth/logout" ||
    // Whether the door is open at all. Public because the login screen has to be able to
    // stop offering a sign-up form that will be refused.
    path === "/auth/policy";
  const isHealthRoute = path === "/health";

  if (isAuthRoute || isHealthRoute) {
    return next();
  }

  // A Bearer token, or failing that the session cookie. Either is the same JWT.
  const credential = credentialOf(req);
  if (!credential) {
    return res.status(401).json({ error: "Unauthorized: Missing token" });
  }

  const token = credential.token;

  try {
    const session = await authService.authenticate(token);
    if (session.status === "invalid") {
      return res.status(401).json({ error: "Unauthorized: Invalid or expired token" });
    }
    if (session.status === "gone") {
      return res.status(401).json({ error: "Unauthorized: account no longer exists" });
    }
    if (session.status === "inactive") {
      return res.status(403).json({ error: "This account has been deactivated." });
    }
    if (session.status === "revoked") {
      return res.status(401).json({ error: "Unauthorized: this session was ended" });
    }

    (req as Request & { user?: unknown; sessionVia?: string }).sessionVia = credential.via;
    (req as Request & { user?: unknown }).user = {
      id: session.user.id,
      username: session.user.username,
      role: session.user.role,
    };
    // From here on every log line and audit event of this request names this person.
    setActor({ type: "user", userId: session.user.id, username: session.user.username });
    next();
  } catch (err) {
    next(err);
  }
}
