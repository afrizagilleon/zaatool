import { Request, Response } from "express";
import { secretsService } from "../services/secrets.service.js";

/** Whose secrets these are: the account asking. `authMiddleware` has run, so there is one. */
const ownerOf = (req: Request): string => (req as Request & { user: { id: string } }).user.id;

/** Postgres' code for a unique violation: the same key twice for one owner. */
const isDuplicateKey = (err: unknown): boolean => (err as { code?: string }).code === "23505";

export class SecretsController {
  async getAll(req: Request, res: Response) {
    try {
      const secrets = await secretsService.getAll(ownerOf(req));
      res.json(secrets);
    } catch (err: any) {
      console.error("Secrets controller error:", err);
      res.status(500).json({ error: "Something went wrong. Please try again." });
    }
  }

  async create(req: Request, res: Response) {
    try {
      const { key, value, is_secret } = req.body;
      const secret = await secretsService.create(ownerOf(req), key, value, Boolean(is_secret));
      res.json(secret);
    } catch (err: any) {
      if (isDuplicateKey(err)) return res.status(409).json({ error: "You already have a secret with that name." });
      console.error("Secrets controller error:", err);
      res.status(500).json({ error: "Something went wrong. Please try again." });
    }
  }

  async update(req: Request, res: Response) {
    try {
      const { key, value, is_secret } = req.body;
      const secret = await secretsService.update(
        ownerOf(req),
        String(req.params.id),
        key,
        value,
        Boolean(is_secret)
      );
      // Somebody else's secret is answered like one that is not there.
      if (!secret) return res.status(404).json({ error: "Secret not found" });
      res.json(secret);
    } catch (err: any) {
      if (isDuplicateKey(err)) return res.status(409).json({ error: "You already have a secret with that name." });
      console.error("Secrets controller error:", err);
      res.status(500).json({ error: "Something went wrong. Please try again." });
    }
  }

  async delete(req: Request, res: Response) {
    try {
      const result = await secretsService.delete(ownerOf(req), String(req.params.id));
      res.json(result);
    } catch (err: any) {
      console.error("Secrets controller error:", err);
      res.status(500).json({ error: "Something went wrong. Please try again." });
    }
  }
}

export const secretsController = new SecretsController();
