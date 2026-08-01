import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { agentTokensService, type AgentScope } from "../services/agent-tokens.service.js";
import { registerNotebookTools } from "../mcp/notebook-tools.js";
import { registerConventions } from "../mcp/conventions.js";
import type { RunEventSink } from "../core/run-emitter.js";

/**
 * The MCP endpoint, over Streamable HTTP.
 *
 * HTTP rather than stdio, and one endpoint rather than one per client, because every
 * agent worth serving speaks it: Claude Code, Hermes over Telegram, and Perplexity —
 * which additionally insists on it. A stdio sidecar would have to be its own process,
 * and then it would have its own run gate and its own event bus, so a run an agent
 * started would be invisible in the browser. Sharing the engine is the whole point.
 *
 * Sessions are kept rather than run stateless: a session is what lets the server ask
 * the client something mid-call, which is how a risky step becomes an approval button
 * in Telegram instead of a decision the agent makes alone.
 */

interface Session {
  transport: StreamableHTTPServerTransport;
  scope: AgentScope;
  /** The token's label, recorded as the author of whatever this session writes. */
  writer: string;
}

/** JSON-RPC has its own shape for failure; an HTML error page would confuse a client. */
function rpcError(res: Response, status: number, message: string): void {
  res.status(status).json({
    jsonrpc: "2.0",
    error: { code: status === 401 ? -32001 : -32000, message },
    id: null,
  });
}

/**
 * Accepts both header styles on purpose: `Authorization: Bearer` is what Claude Code
 * and Hermes send, `X-API-Key` is what Perplexity's connector sends. One token, two
 * spellings, rather than two ways in.
 */
function presentedToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    return header.slice("Bearer ".length).trim();
  }
  const apiKey = req.headers["x-api-key"];
  if (typeof apiKey === "string" && apiKey.trim()) return apiKey.trim();
  return null;
}

export function createMcpRouter(publishRunEvent: RunEventSink): Router {
  const router = Router();
  const sessions = new Map<string, Session>();

  /** Every request is authenticated, including ones on an established session. */
  async function authenticate(
    req: Request,
    res: Response
  ): Promise<{ scope: AgentScope; writer: string } | null> {
    const token = presentedToken(req);
    if (!token) {
      rpcError(res, 401, "Missing agent token. Send Authorization: Bearer <token> or X-API-Key.");
      return null;
    }
    const record = await agentTokensService.verify(token);
    if (!record) {
      rpcError(res, 401, "Unknown or revoked agent token.");
      return null;
    }
    return { scope: record.scope, writer: record.label };
  }

  function sessionFor(req: Request): Session | undefined {
    const id = req.headers["mcp-session-id"];
    return typeof id === "string" ? sessions.get(id) : undefined;
  }

  router.post("/", async (req: Request, res: Response) => {
    try {
      const identity = await authenticate(req, res);
      if (!identity) return;
      const { scope, writer } = identity;

      const existing = sessionFor(req);
      if (existing) {
        // A token that was downgraded or revoked must not keep its old reach through a
        // session opened while it still had it.
        if (existing.scope !== scope) {
          rpcError(res, 401, "This session was opened with a different token scope. Reconnect.");
          return;
        }
        await existing.transport.handleRequest(req, res, req.body);
        return;
      }

      if (!isInitializeRequest(req.body)) {
        rpcError(res, 400, "No such session. Send an initialize request first.");
        return;
      }

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sessionId) => {
          sessions.set(sessionId, { transport, scope, writer });
        },
      });

      transport.onclose = () => {
        if (transport.sessionId) sessions.delete(transport.sessionId);
      };

      const server = new McpServer({ name: "zaatool", version: "1.0.0" });
      registerNotebookTools(server, { publishRunEvent, writer }, scope);
      registerConventions(server);
      await server.connect(transport);

      await transport.handleRequest(req, res, req.body);
    } catch (err: unknown) {
      console.error("MCP request failed:", (err as Error).message);
      if (!res.headersSent) rpcError(res, 500, (err as Error).message);
    }
  });

  /** GET opens the server-to-client stream; DELETE ends the session. */
  const continueSession = async (req: Request, res: Response): Promise<void> => {
    const identity = await authenticate(req, res);
    if (!identity) return;

    const session = sessionFor(req);
    if (!session) {
      rpcError(res, 404, "No such session.");
      return;
    }
    await session.transport.handleRequest(req, res);
  };

  router.get("/", continueSession);
  router.delete("/", continueSession);

  return router;
}
