/**
 * Who did something, in one shape for every way into the engine.
 *
 * Before this there were three spellings of the same person (a user id on runs, a username
 * on deploys and shares, a token's label as `writer`), and an agent called "alice" could not
 * be told apart from the user `alice`. Every operational log line and every audit event now
 * names its actor with this type, and `type` is always there so the namespaces never mix.
 *
 * Identity is the id. Names (`username`, `label`, `client`) are kept beside it as they were
 * at the time, because an audit trail must still read sensibly after a rename or a delete.
 */
export type Actor =
  /** A person signed in through the browser (session cookie or Bearer JWT). */
  | { type: "user"; userId: string; username: string }
  /**
   * An AI agent over MCP. `tokenId` is the identity; `userId` is the person the token
   * belongs to and acts for. `client` is what the MCP client said about itself in
   * `initialize` (e.g. "claude-ai/1.0"): self-reported, recorded, never trusted.
   */
  | {
      type: "agent";
      tokenId: string;
      label: string;
      userId: string;
      username?: string;
      client?: string;
    }
  /** A request to `/hooks/<slug>`. Identified by the trigger row, never by the slug. */
  | { type: "webhook"; triggerId: string; notebookId: string }
  /** The scheduler firing a cron trigger. */
  | { type: "cron"; triggerId: string; notebookId: string }
  /** Somebody without an account using a share link. Identified by the share row. */
  | { type: "share"; shareId: string; notebookId: string }
  /** A command-line script run on the server (`create-user`, `rotate-secrets-key`, …). */
  | { type: "cli"; command: string; osUser?: string }
  /** The engine itself: boot, reconciliation, cleanup. */
  | { type: "system"; component: string }
  /** Not identified yet (before authentication, or a refused credential). */
  | { type: "anonymous" };

/** The flat form used in log lines and audit rows. Undefined fields are dropped. */
export function actorFields(actor: Actor | undefined): Record<string, string> {
  if (!actor) return {};
  const out: Record<string, string | undefined> = { "actor.type": actor.type };
  switch (actor.type) {
    case "user":
      out["actor.user_id"] = actor.userId;
      out["actor.username"] = actor.username;
      break;
    case "agent":
      out["actor.token_id"] = actor.tokenId;
      out["actor.label"] = actor.label;
      out["actor.user_id"] = actor.userId;
      out["actor.username"] = actor.username;
      out["actor.client"] = actor.client;
      break;
    case "webhook":
    case "cron":
      out["actor.trigger_id"] = actor.triggerId;
      out["actor.notebook_id"] = actor.notebookId;
      break;
    case "share":
      out["actor.share_id"] = actor.shareId;
      out["actor.notebook_id"] = actor.notebookId;
      break;
    case "cli":
      out["actor.command"] = actor.command;
      out["actor.os_user"] = actor.osUser;
      break;
    case "system":
      out["actor.component"] = actor.component;
      break;
    case "anonymous":
      break;
  }
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as Record<string, string>;
}

/** The user an actor acts as or for, when there is one. */
export function actingUserId(actor: Actor | undefined): string | null {
  if (!actor) return null;
  if (actor.type === "user" || actor.type === "agent") return actor.userId;
  return null;
}
