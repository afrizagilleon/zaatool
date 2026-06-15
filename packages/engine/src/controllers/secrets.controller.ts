import { Request, Response } from "express";
import { secretsService } from "../services/secrets.service.js";

export class SecretsController {
  async getAll(req: Request, res: Response) {
    try {
      const secrets = await secretsService.getAll();
      res.json(secrets);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  async create(req: Request, res: Response) {
    try {
      const { key, value, is_secret } = req.body;
      const secret = await secretsService.create(key, value, Boolean(is_secret));
      res.json(secret);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  async update(req: Request, res: Response) {
    try {
      const { key, value, is_secret } = req.body;
      const secret = await secretsService.update(String(req.params.id), key, value, Boolean(is_secret));
      res.json(secret);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  async delete(req: Request, res: Response) {
    try {
      const result = await secretsService.delete(String(req.params.id));
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
}

export const secretsController = new SecretsController();
