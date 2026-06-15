import { Request, Response, NextFunction } from "express";
import { authService } from "../services/auth.service.js";

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const path = req.path;
  const method = req.method;

  // Define public routes
  const isAuthRoute = path.startsWith("/auth/login") || path.startsWith("/auth/register");
  const isHealthRoute = path === "/health";
  const isGraphsRoute = path === "/graphs";
  const isPublicFlowRoute = path.startsWith("/flows/") && path.endsWith("/public") && method === "GET";
  const isPublicTriggerRoute = path.startsWith("/flows/") && path.includes("/trigger") && method === "POST";

  if (isAuthRoute || isHealthRoute || isGraphsRoute || isPublicFlowRoute || isPublicTriggerRoute) {
    return next();
  }

  // Check authorization header
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized: Missing token" });
  }

  const token = authHeader.split(" ")[1];
  const decoded = authService.verifyToken(token);

  if (!decoded) {
    return res.status(401).json({ error: "Unauthorized: Invalid or expired token" });
  }

  // Attach decoded user info to request
  (req as any).user = decoded;
  next();
}
