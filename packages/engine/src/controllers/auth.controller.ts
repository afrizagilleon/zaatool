import { Request, Response } from "express";
import { authService } from "../services/auth.service.js";

export class AuthController {
  async register(req: Request, res: Response) {
    try {
      const { username, password, email } = req.body;
      if (!username || !password) {
        return res.status(400).json({ error: "Username and password are required" });
      }
      const user = await authService.register(username, password, email);
      res.status(201).json({ success: true, user });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
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
    } catch (err: any) {
      res.status(401).json({ error: err.message });
    }
  }

  async getMe(req: Request, res: Response) {
    // If request passes auth middleware, user information is attached to req.user
    const user = (req as any).user;
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    res.json({ success: true, user });
  }
}

export const authController = new AuthController();
