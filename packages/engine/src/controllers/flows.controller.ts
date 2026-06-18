import { Request, Response } from "express";
import { flowsService } from "../services/flows.service.js";

export class FlowsController {
  async getAll(req: Request, res: Response) {
    try {
      const flows = await flowsService.getAll();
      res.json(flows);
    } catch (e: unknown) {
      res.status(500).json({ error: (e as Error).message });
    }
  }

  async getSummary(req: Request, res: Response) {
    try {
      const summary = await flowsService.getSummary();
      res.json(summary);
    } catch (e: unknown) {
      res.status(500).json({ error: (e as Error).message });
    }
  }

  async getById(req: Request, res: Response) {
    try {
      const flow = await flowsService.getById(String(req.params.id));
      if (!flow) {
        return res.status(404).json({ error: "Not found" });
      }
      const { graph_json, dashboard_layout } = flowsService.parseFlow(flow);
      res.json({
        id: flow.id,
        name: flow.name,
        graph_json,
        dashboard_layout,
        dashboard_password: flow.dashboard_password_hash ? "[UNCHANGED]" : "",
      });
    } catch (e: unknown) {
      res.status(500).json({ error: (e as Error).message });
    }
  }

  async save(req: Request, res: Response) {
    try {
      const { id, name, graph_json, dashboard_layout, dashboard_password } = req.body;
      const result = await flowsService.save(id, name, graph_json, dashboard_layout, dashboard_password);
      res.json(result);
    } catch (e: unknown) {
      res.status(500).json({ error: (e as Error).message });
    }
  }

  async delete(req: Request, res: Response) {
    try {
      const result = await flowsService.delete(String(req.params.id));
      res.json(result);
    } catch (e: unknown) {
      res.status(500).json({ error: (e as Error).message });
    }
  }
}

export const flowsController = new FlowsController();
