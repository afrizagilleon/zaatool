import { Request, Response } from "express";
import { flowsService } from "../services/flows.service.js";

export class FlowsController {
  async getAll(req: Request, res: Response) {
    try {
      const flows = await flowsService.getAll();
      res.json(flows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }

  async getSummary(req: Request, res: Response) {
    try {
      const summary = await flowsService.getSummary();
      res.json(summary);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }

  async getById(req: Request, res: Response) {
    try {
      const flow = await flowsService.getById(String(req.params.id));
      if (!flow) {
        return res.status(404).json({ error: "Not found" });
      }
      res.json(flow);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }

  async save(req: Request, res: Response) {
    try {
      const { id, name, graph_json, dashboard_layout } = req.body;
      const result = await flowsService.save(id, name, graph_json, dashboard_layout);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }

  async delete(req: Request, res: Response) {
    try {
      const result = await flowsService.delete(String(req.params.id));
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }
}

export const flowsController = new FlowsController();
