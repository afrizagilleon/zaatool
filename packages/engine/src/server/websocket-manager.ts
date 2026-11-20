import { WebSocketServer, WebSocket } from "ws";
import { Server } from "http";
import type {
  CatalogChangedEvent,
  RunActivityEvent,
  RunClientMessage,
  RunDeniedEvent,
  RunEvent,
} from "@zaa-tool/shared";
import type { RunEventHub } from "./run-event-hub.js";
import { onCatalogChanged } from "../core/catalog-events.js";
import { authService } from "../services/auth.service.js";
import { notebookSharesService } from "../services/notebook-shares.service.js";
import { notebookAccessService } from "../services/notebook-access.service.js";

/** Guards against a single socket holding open an unbounded number of channels. */
const MAX_SUBSCRIPTIONS_PER_SOCKET = 20;

/**
 * How long a socket may stay silent before it is closed.
 *
 * Long enough that a slow page still gets its first frame out, short enough that an open
 * port is not a place to park connections.
 */
const AUTH_GRACE_MS = 10_000;

function parseMessage(raw: unknown): RunClientMessage | null {
  if (typeof raw !== "string") return null;
  try {
    const message: unknown = JSON.parse(raw);
    if (typeof message !== "object" || message === null) return null;
    const { action, runId, token } = message as {
      action?: string;
      runId?: string;
      token?: string;
    };
    if (action === "auth") {
      return typeof token === "string" && token.length > 0 ? { action, token } : null;
    }
    if (action === "watch") return { action: "watch" };
    if (action !== "subscribe" || typeof runId !== "string" || runId.length === 0) return null;
    return { action, runId };
  } catch {
    return null;
  }
}

/**
 * Who a socket turned out to be.
 *
 * `session` is somebody signed in to this installation. `share` is a page handed to
 * somebody who is not — it can follow a run, because a shared page runs its notebook and
 * has to show the result, but it cannot ask what else is happening here.
 */
type Caller = { kind: "session"; userId: string } | { kind: "share"; notebookId: string };

async function identify(token: string): Promise<Caller | null> {
  const session = authService.verifyToken(token);
  if (session) return { kind: "session", userId: session.id };
  const share = await notebookSharesService.resolve(token);
  return share ? { kind: "share", notebookId: share.notebook_id } : null;
}

/**
 * The only events a watcher is told about, and only that something happened.
 *
 * Deliberately excludes `cell:log` and `cell:done`: the watch channel is not scoped to
 * a run the client proved it started, so nothing carrying a value may travel on it.
 */
const ACTIVITY_EVENTS = new Set<RunEvent["type"]>(["cell:start", "run:done", "run:error"]);

function toActivity(event: RunEvent): RunActivityEvent | null {
  if (!ACTIVITY_EVENTS.has(event.type)) return null;

  const status: RunActivityEvent["status"] =
    event.type === "run:done" ? "success" : event.type === "run:error" ? "failed" : "running";

  return { type: "run:activity", runId: event.runId, notebookId: event.notebookId, status };
}

/**
 * Owns the WebSocket lifecycle only. It does not decide what an event contains — routing
 * and buffering belong to {@link RunEventHub}.
 *
 * It does decide *who is listening*. A socket says who it is first; until it has, it can
 * ask for nothing. After that two rules apply, and they differ because the two channels
 * differ:
 *
 *  - `subscribe` still needs the run id, which a client only gets from the response that
 *    started that run. Authentication is a second lock on that door, not a replacement —
 *    and the run id is not a credential on its own either: a session follows a run only if
 *    it could read that run over REST, and a share link only the runs of its own notebook.
 *  - `watch` needs a session. It used to name every notebook that runs anywhere in this
 *    installation; it now names only the runs the session could read over REST, and the
 *    catalog changes it could see. A share token, which was issued for exactly one page,
 *    does not reach it at all.
 */
export class WebSocketManager {
  private wss: WebSocketServer;

  constructor(server: Server, private hub: RunEventHub) {
    // On a path of its own. Mounted at the server root, the upgrade request arrived at
    // `/` — which behind the deployed nginx is the single-page app, so the socket was
    // answered with `index.html` and the run stream could not connect at all. A named
    // path is also what lets a dev server proxy it, since the root belongs to the app.
    this.wss = new WebSocketServer({ server, path: "/ws" });

    this.wss.on("error", (err) => {
      console.error("❌ WebSocket server error:", err.message);
    });

    this.wss.on("connection", (ws) => {
      const unsubscribes = new Map<string, () => void>();
      let caller: Caller | null = null;

      const deny = (reason: string, close = false) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        const event: RunDeniedEvent = { type: "run:denied", reason };
        ws.send(JSON.stringify(event));
        if (close) ws.close();
      };

      const graceTimer = setTimeout(() => {
        if (!caller) deny("This stream needs an `auth` message first.", true);
      }, AUTH_GRACE_MS);

      /**
       * Checking a token means a database lookup for share links, so a client that sends
       * `auth` and `subscribe` back to back — which every client here does — would be
       * refused for arriving too fast. Anything sent while the check is in flight waits
       * behind it instead, in the order it arrived.
       */
      let checking: Promise<void> | null = null;

      /**
       * Whether an event is for this socket is a question for the database, and answering
       * out of order would send a run's `done` before its `start`. Everything that has to
       * be decided goes through one chain per socket, in the order it arrived.
       */
      let decisions: Promise<void> = Promise.resolve();
      const decide = (task: () => Promise<void>) => {
        decisions = decisions.then(task).catch((err: unknown) => {
          console.error("WebSocket delivery error:", (err as Error).message);
        });
      };

      const handle = (message: Exclude<RunClientMessage, { action: "auth" }>) => {
        if (!caller) {
          return deny("Send `auth` before subscribing.");
        }

        if (message.action === "watch") {
          if (caller.kind !== "session") {
            return deny("Watching the workspace needs an account here.");
          }
          if (unsubscribes.has("*")) return;
          const { userId } = caller;
          // Remembered per run: whether a run is somebody's to see does not change while it
          // runs, and asking again for every cell of a long one would be a query per event.
          const verdicts = new Map<string, boolean>();
          unsubscribes.set(
            "*",
            this.hub.watch((event) => {
              const activity = toActivity(event);
              if (!activity) return;
              decide(async () => {
                let allowed = verdicts.get(event.runId);
                if (allowed === undefined) {
                  allowed = await notebookAccessService.canSeeRunId(userId, event.runId);
                  verdicts.set(event.runId, allowed);
                  if (verdicts.size > 500) verdicts.delete(verdicts.keys().next().value as string);
                }
                if (allowed && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(activity));
              });
            })
          );

          // The same subscription carries the other kind of change, because a screen
          // showing notebooks wants both and they are one question in practice: *is what
          // I am looking at still true.* It is on the session-only channel for the same
          // reason run activity is — it names notebooks by id across the whole
          // installation, including ones a share link's reader has never been shown.
          //
          // And only the part of it this session could see: the notice names a notebook by
          // id, and an id the session was never shown is not something it is told about.
          unsubscribes.set(
            "catalog",
            onCatalogChanged((notice) => {
              decide(async () => {
                if (ws.readyState !== WebSocket.OPEN) return;
                if (!(await notebookAccessService.hearsCatalogChange(userId, notice))) return;
                // Built field by field: the notice carries who may hear it, and that list is
                // not the client's to receive.
                const event: CatalogChangedEvent = {
                  type: "catalog:changed",
                  change: notice.change,
                  notebookId: notice.notebookId,
                };
                ws.send(JSON.stringify(event));
              });
            })
          );
          return;
        }

        if (unsubscribes.has(message.runId)) return;
        if (unsubscribes.size >= MAX_SUBSCRIPTIONS_PER_SOCKET) return;

        const { runId } = message;
        const who = caller;
        // Reserved before the check answers, so two quick `subscribe`s for one run are one
        // subscription and not two.
        unsubscribes.set(runId, () => {});
        decide(async () => {
          const allowed =
            who.kind === "session"
              ? await notebookAccessService.canSeeRunId(who.userId, runId)
              : await notebookAccessService.runBelongsTo(runId, who.notebookId);
          if (!allowed) {
            unsubscribes.delete(runId);
            return deny("That run is not one this connection may follow.");
          }
          if (ws.readyState !== WebSocket.OPEN) {
            unsubscribes.delete(runId);
            return;
          }
          unsubscribes.set(
            runId,
            this.hub.subscribe(runId, (event) => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(event));
              }
            })
          );
        });
      };

      ws.on("message", (raw) => {
        const message = parseMessage(raw.toString());
        if (!message) return;

        if (message.action === "auth") {
          checking = identify(message.token).then((identified) => {
            if (!identified) return deny("That token was not accepted.", true);
            caller = identified;
          });
          return;
        }

        if (checking) {
          void checking.then(() => handle(message));
          return;
        }
        handle(message);
      });

      const release = () => {
        clearTimeout(graceTimer);
        for (const unsubscribe of unsubscribes.values()) unsubscribe();
        unsubscribes.clear();
      };

      ws.on("close", release);
      ws.on("error", (err) => {
        console.error("WebSocket client error:", err.message);
        release();
      });
    });
  }

  close() {
    this.wss.close();
  }
}
