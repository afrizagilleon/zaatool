import { Request, Response } from "express";
import { AuthInputError, authService, isRole, RegistrationClosedError, SetupCodeError } from "../services/auth.service.js";
import { cronTimezone, registrationOpen } from "../config.js";
import { pool } from "../db/connection.js";
import { clearSessionCookie, setSessionCookie } from "../middleware/session-cookie.js";
import { internalError } from "../core/http-errors.js";

/**
 * The one place that decides what a failure is allowed to say out loud.
 *
 * `AuthInputError` carries a message written for the person who caused it, so it is sent
 * as-is under whatever status the route considers a refusal — 400 for a form, 401 for a
 * sign-in. Anything else is a fault on our side: it goes to the log in full and to the
 * client as a sentence that describes nothing.
 */
function refuse(res: Response, err: unknown, where: string, status = 400) {
  if (err instanceof AuthInputError) {
    return res.status(status).json({ error: err.message });
  }
  return internalError(res, err, "auth.request_failed", { where });
}

export class AuthController {
  /**
   * What the login screen needs to know before it draws itself.
   *
   * Carries no names and no counts — only whether a sign-up form would be accepted, and
   * whether this is a fresh installation with nobody in it yet.
   */
  async policy(_req: Request, res: Response) {
    try {
      const count = await authService.userCount();
      res.json({
        registrationOpen: count === 0 || registrationOpen(),
        firstUser: count === 0,
        cronTimezone: cronTimezone(),
      });
    } catch (err) {
      internalError(res, err, "auth.policy_failed");
    }
  }

  async register(req: Request, res: Response) {
    try {
      const { username, password, email, setupCode } = req.body;
      if (!username || !password) {
        return res.status(400).json({ error: "Username and password are required" });
      }
      const user = await authService.register(username, password, email, setupCode);
      res.status(201).json({ success: true, user });
    } catch (err) {
      if (err instanceof RegistrationClosedError || err instanceof SetupCodeError) {
        return res.status(403).json({ error: err.message });
      }
      refuse(res, err, "Register error");
    }
  }

  async inviteUser(req: Request, res: Response) {
    try {
      const { username, password, email, role } = req.body;
      if (!username || !password) {
        return res.status(400).json({ error: "Username and password are required" });
      }
      if (!isRole(role)) {
        return res.status(400).json({ error: "Role must be creator or viewer" });
      }
      const user = await authService.createUser(username, password, role, email);
      res.status(201).json({ success: true, user });
    } catch (err) {
      refuse(res, err, "Invite user error");
    }
  }

  async listUsers(_req: Request, res: Response) {
    try {
      res.json({ success: true, users: await authService.listUsers() });
    } catch (err) {
      internalError(res, err, "auth.list_users_failed");
    }
  }

  async login(req: Request, res: Response) {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ error: "Username and password are required" });
      }
      const result = await authService.login(username, password);
      // The cookie is what the browser uses; the token in the body is for everything that
      // is not a browser (the `curl` examples in DEPLOY.md, scripts) and the web app drops it.
      setSessionCookie(res, result.token);
      res.json({ success: true, ...result });
    } catch (err) {
      refuse(res, err, "Login error", 401);
    }
  }

  async getMe(req: Request, res: Response) {
    const user = (req as Request & { user?: { id: string } }).user;
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const { rows } = await pool.query(
        "SELECT id, username, email, role FROM users WHERE id = $1",
        [user.id]
      );
      if (rows.length === 0) {
        return res.status(404).json({ error: "User not found" });
      }
      res.json({ success: true, user: rows[0] });
    } catch (err) {
      internalError(res, err, "auth.get_me_failed");
    }
  }

  async setActive(req: Request, res: Response) {
    try {
      // `String(...)` rather than destructuring: Express 5 types a route parameter as
      // `string | string[]`, and the compiler is right to insist. Same shape every other
      // controller here uses.
      const id = String(req.params.id);
      const { active } = req.body;
      if (typeof active !== "boolean") {
        return res.status(400).json({ error: "active field must be a boolean" });
      }
      const currentUser = (req as Request & { user?: { id: string } }).user;
      if (currentUser && currentUser.id === id && active === false) {
        return res.status(400).json({ error: "You cannot deactivate the account you are signed in as." });
      }
      const updated = await authService.setActive(id, active);
      if (!updated) {
        return res.status(404).json({ error: "User not found" });
      }
      res.json({ success: true, active });
    } catch (err) {
      refuse(res, err, "Set active error");
    }
  }

  /** Signs this browser out: the cookie goes, sessions on other devices stay. */
  async logout(_req: Request, res: Response) {
    clearSessionCookie(res);
    res.json({ success: true });
  }

  /**
   * "Sign out everywhere": outdates every token this account holds, including the one
   * that made the request. The caller is expected to be signed out afterwards.
   */
  async logoutAll(req: Request, res: Response) {
    const user = (req as Request & { user?: { id: string } }).user;
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      await authService.revokeSessions(user.id);
      clearSessionCookie(res);
      res.json({ success: true });
    } catch (err) {
      refuse(res, err, "Logout all error");
    }
  }

  async changePassword(req: Request, res: Response) {
    try {
      const user = (req as Request & { user?: { id: string } }).user;
      if (!user) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const { currentPassword, newPassword } = req.body || {};
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: "Current password and new password are required" });
      }
      await authService.changePassword(user.id, currentPassword, newPassword);
      // Changing the password ended every session, this one included. The person who just
      // did it is handed a fresh token so they are not signed out of the screen they are
      // looking at; everyone else, on every other device, is.
      const token = await authService.reissueSession(user.id);
      if (token && (req as Request & { sessionVia?: string }).sessionVia === "cookie") {
        setSessionCookie(res, token);
      }
      res.json({ success: true, token });
    } catch (err) {
      refuse(res, err, "Change password error");
    }
  }
}

export const authController = new AuthController();
