import { Request, Response } from "express";
import { authService, isRole, RegistrationClosedError } from "../services/auth.service.js";
import { registrationOpen } from "../config.js";
import { pool } from "../db/connection.js";

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
      res.json({ registrationOpen: count === 0 || registrationOpen(), firstUser: count === 0 });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  }

  async register(req: Request, res: Response) {
    try {
      const { username, password, email } = req.body;
      if (!username || !password) {
        return res.status(400).json({ error: "Username and password are required" });
      }
      const user = await authService.register(username, password, email);
      res.status(201).json({ success: true, user });
    } catch (err) {
      const status = err instanceof RegistrationClosedError ? 403 : 400;
      res.status(status).json({ error: (err as Error).message });
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
      res.status(400).json({ error: (err as Error).message });
    }
  }

  async listUsers(_req: Request, res: Response) {
    try {
      res.json({ success: true, users: await authService.listUsers() });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  }

  async login(req: Request, res: Response) {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ error: "Username and password are required" });
      }
      const result = await authService.login(username, password);
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(401).json({ error: (err as Error).message });
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
      res.status(500).json({ error: (err as Error).message });
    }
  }

  async setActive(req: Request, res: Response) {
    try {
      const { id } = req.params;
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
      res.status(400).json({ error: (err as Error).message });
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
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  }
}



export const authController = new AuthController();
