import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { agentTokensService, type AgentScope } from "../services/agent-tokens.service.js";
import { authService } from "../services/auth.service.js";
import { registerNotebookTools } from "../mcp/notebook-tools.js";
import { registerConventions } from "../mcp/conventions.js";
import { onCatalogChanged, registerDeployedNotebooks } from "../mcp/notebook-catalog.js";
import type { RunEventSink } from "../core/run-emitter.js";
import { logger } from "../core/logger.js";
import { INTERNAL_ERROR_MESSAGE } from "../core/http-errors.js";
import { currentContext, setActor, withContext } from "../core/request-context.js";
import { audit } from "../services/audit.service.js";

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
  /** The account the token acts as. Every tool answers for them and nobody else. */
  userId: string;
  /** What the client said it was in `initialize`, sanitised (`name/version`); undefined if it said nothing. */
  client?: string;
}

/**
 * What the client calls itself, from the `clientInfo` of its `initialize` request.
 *
 * Self-reported and free text, so it is only ever *recorded* (never used to decide anything),
 * and it is cleaned and capped first: it lands in logs, audit rows and exports. Claude,
 * ChatGPT and Hermes each send their own name, which is what tells their sessions apart when
 * several share one token label.
 */
export function clientOf(body: unknown): string | undefined {
  if (!isInitializeRequest(body)) return undefined;
  const info = (body.params as { clientInfo?: { name?: unknown; version?: unknown } } | undefined)?.clientInfo;
  if (!info || typeof info.name !== "string") return undefined;
  // eslint-disable-next-line no-control-regex
  const clean = (value: string, max: number) => value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
  const name = clean(info.name, 64);
  if (!name) return undefined;
  const version = typeof info.version === "string" ? clean(info.version, 32) : "";
  return version ? `${name}/${version}` : name;
}

/** The token a session was opened with, as an audit target: events about a token are visible to its owner. */
function snapshotTarget(context: ReturnType<typeof currentContext>) {
  const actor = context?.actor;
  return actor?.type === "agent"
    ? { type: "agent_token", id: actor.tokenId, ownerId: actor.userId, name: actor.label }
    : undefined;
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
export function agentTokenOf(req: Request): string | null {
  return presentedToken(req);
}

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
  ): Promise<{ scope: AgentScope; writer: string; userId: string; client?: string } | null> {
    const token = presentedToken(req);
    if (!token) {
      await audit.record({ action: "agent.auth_failed", outcome: "denied", meta: { reason: "missing_token" } });
      rpcError(res, 401, "Missing agent token. Send Authorization: Bearer <token> or X-API-Key.");
      return null;
    }
    const record = await agentTokensService.verify(token);
    if (!record) {
      // A revoked token is still known by its hash, so the refusal can name which one it was
      // (and whose); a made-up one names nobody. The token itself is never written.
      const known = await agentTokensService.identify(token);
      await audit.record({
        action: "agent.auth_failed",
        outcome: "denied",
        target: known ? { type: "agent_token", id: known.id, ownerId: known.user_id, name: known.label } : undefined,
        meta: { reason: known?.revoked ? "revoked_token" : "unknown_token" },
      });
      rpcError(res, 401, "Unknown or revoked agent token.");
      return null;
    }

    // A token is an account. It stops working with the account, and it cannot do more than
    // the account may: `author` writes only while its user is still a creator, so demoting
    // somebody to viewer takes their agents' write access with them, with no list of tokens
    // to go through. (A session opened earlier notices below, because the scope differs.)
    const user = record.user_id ? await authService.currentUser(record.user_id) : null;
    if (!user || user.active === false) {
      await audit.record({
        action: "agent.auth_failed",
        outcome: "denied",
        target: { type: "agent_token", id: record.id, ownerId: record.user_id, name: record.label },
        meta: { reason: "account_inactive" },
      });
      rpcError(res, 401, "The account this agent token belongs to is gone or deactivated.");
      return null;
    }
    const scope: AgentScope =
      record.scope === "author" && user.role === "creator" ? "author" : "reader";

    // The client is told once, in `initialize`; every later request of the session is
    // attributed to the same one. From here on the request's actor is this token: what the
    // tools write, the runs they start and every log line name it, not just its label.
    const client = sessionFor(req)?.client ?? clientOf(req.body);
    setActor({
      type: "agent",
      tokenId: record.id,
      label: record.label,
      userId: user.id,
      username: user.username,
      client,
    });
    return { scope, writer: record.label, userId: user.id, client };
  }

  function sessionFor(req: Request): Session | undefined {
    const id = req.headers["mcp-session-id"];
    return typeof id === "string" ? sessions.get(id) : undefined;
  }

  router.post("/", async (req: Request, res: Response) => {
    try {
      const identity = await authenticate(req, res);
      if (!identity) return;
      const { scope, writer, userId, client } = identity;

      const existing = sessionFor(req);
      if (existing) {
        // A token that was downgraded or revoked must not keep its old reach through a
        // session opened while it still had it.
        if (existing.scope !== scope || existing.userId !== userId) {
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
        onsessioninitialized: async (sessionId) => {
          sessions.set(sessionId, { transport, scope, writer, userId, client });
          // Awaited, so the row exists by the time the client has its answer. Run in a copy of
          // this request's context in case the transport called back from somewhere that lost it.
          const snapshot = currentContext();
          await withContext({ ...snapshot }, () =>
            audit.record({
              action: "agent.session_start",
              target: snapshotTarget(snapshot),
              meta: { client: client ?? null, scope },
            })
          );
        },
      });

      const server = new McpServer({ name: "zaatool", version: "1.0.0" });
      registerNotebookTools(server, { publishRunEvent, writer, userId }, scope);
      registerConventions(server);
      await registerDeployedNotebooks(server, { publishRunEvent, userId });

      // Deploying a notebook adds a capability, and a session opened this morning
      // should learn about it without reconnecting. The server only announces that the
      // list changed; the client re-reads it when it cares.
      const onCatalogChange = () => {
        try {
          server.server.sendToolListChanged();
        } catch {
          // A client that closed mid-notification is not an error worth logging.
        }
      };
      const stopWatchingCatalog = onCatalogChanged(onCatalogChange);

      transport.onclose = () => {
        stopWatchingCatalog();
        if (transport.sessionId) sessions.delete(transport.sessionId);
      };

      await server.connect(transport);

      await transport.handleRequest(req, res, req.body);
    } catch (err: unknown) {
      // The caller is an agent, not a person at a login screen, but what it is told is still
      // only that the engine failed; the cause is in the log under this request's id.
      logger.error("MCP request failed.", { event: "mcp.request_failed", err });
      if (!res.headersSent) rpcError(res, 500, `${INTERNAL_ERROR_MESSAGE} (request ${currentContext()?.requestId ?? "unknown"})`);
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
