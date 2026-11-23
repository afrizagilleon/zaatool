import { Request, Response } from "express";
import { skillsService } from "../services/skills.service.js";
import { internalError } from "../core/http-errors.js";

export class SkillsController {
  async getAll(req: Request, res: Response) {
    try {
      const skills = await skillsService.getAll();
      res.json(skills);
    } catch (err: any) {
      internalError(res, err, "skills.request_failed");
    }
  }

  async create(req: Request, res: Response) {
    try {
      const { name, description, content } = req.body;
      const skill = await skillsService.create(name, description, content);
      res.json(skill);
    } catch (err: any) {
      internalError(res, err, "skills.request_failed");
    }
  }

  async update(req: Request, res: Response) {
    try {
      const { name, description, content } = req.body;
      const skill = await skillsService.update(String(req.params.id), name, description, content);
      res.json(skill);
    } catch (err: any) {
      internalError(res, err, "skills.request_failed");
    }
  }

  async delete(req: Request, res: Response) {
    try {
      const result = await skillsService.delete(String(req.params.id));
      res.json(result);
    } catch (err: any) {
      internalError(res, err, "skills.request_failed");
    }
  }
}

export const skillsController = new SkillsController();
