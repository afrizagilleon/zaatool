import { createHash, randomBytes, randomUUID } from "node:crypto";
import { pool } from "../db/connection.js";
import { audit } from "./audit.service.js";

/**
 * Credentials for agents, kept apart from the browser's session.
 *
 * An agent is not a user with a login: it connects unattended, it lives somewhere you
 * do not control, and it should be revocable on its own without signing you out. So it
 * gets its own token, stored as a hash — a leaked database row is not a working key.
 *
 * The scope is the honest part. `author` may write and run; `reader` may only look and
 * run. Neither can deploy, because until a notebook is deployed nothing an agent writes
 * reaches production, and that gate belongs to a person.
 */
export type AgentScope = "author" | "reader";

export interface AgentToken {
  id: string;
  label: string;
  scope: AgentScope;
  /** The account the token acts as. Null only for a token that predates accounts having any. */
  user_id: string | null;
  created_at: Date;
  last_used_at: Date | null;
}

const TOKEN_PREFIX = "zaa_";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export class AgentTokensService {
  /**
   * Returns the token once. It is never recoverable afterwards — only its hash is kept.
   *
   * It belongs to `userId` and acts as them: it sees what they see and, with `author`
   * scope, writes what they may write — for as long as they are still a creator.
   */
  async issue(
    userId: string,
    label: string,
    scope: AgentScope
  ): Promise<{ token: string; record: AgentToken }> {
    const token = `${TOKEN_PREFIX}${randomBytes(32).toString("hex")}`;
    const id = randomUUID();

    const { rows } = await pool.query(
      `INSERT INTO agent_tokens (id, label, scope, token_hash, user_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, label, scope, user_id, created_at, last_used_at`,
      [id, label, scope, hashToken(token), userId]
    );

    // The token itself is never recorded: the id is what every later event names it by.
    await audit.record({
      action: "agent_token.issue",
      target: { type: "agent_token", id, ownerId: userId, name: label },
      meta: { scope },
    });
    return { token, record: rows[0] };
  }

  /**
   * A person's own tokens. Left out, every token on the installation — which only the
   * server's terminal asks for.
   */
  async list(userId?: string): Promise<AgentToken[]> {
    const { rows } = await pool.query(
      `SELECT id, label, scope, user_id, created_at, last_used_at
       FROM agent_tokens
       WHERE revoked_at IS NULL AND ($1::text IS NULL OR user_id = $1)
       ORDER BY created_at DESC`,
      [userId ?? null]
    );
    return rows;
  }

  /** Somebody else's token is not revoked — and is not found, which is what the caller is told. */
  async revoke(id: string, userId?: string): Promise<{ revoked: boolean }> {
    const { rows } = await pool.query<{ label: string; user_id: string | null }>(
      `UPDATE agent_tokens SET revoked_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND revoked_at IS NULL AND ($2::text IS NULL OR user_id = $2)
       RETURNING label, user_id`,
      [id, userId ?? null]
    );
    if (rows[0]) {
      await audit.record({
        action: "agent_token.revoke",
        target: { type: "agent_token", id, ownerId: rows[0].user_id, name: rows[0].label },
      });
    }
    return { revoked: rows.length > 0 };
  }

  /**
   * Who a presented token was, revoked or not, so a refusal can name the token that was
   * refused. Never used to let anything in.
   */
  async identify(token: string): Promise<{ id: string; label: string; user_id: string | null; revoked: boolean } | null> {
    if (!token.startsWith(TOKEN_PREFIX)) return null;
    const { rows } = await pool.query(
      "SELECT id, label, user_id, revoked_at IS NOT NULL AS revoked FROM agent_tokens WHERE token_hash = $1",
      [hashToken(token)]
    );
    return rows[0] ?? null;
  }

  /**
   * Resolves a presented token, or null.
   *
   * `last_used_at` is written on every accepted call: an agent that goes quiet, or one
   * still being used after you thought it was retired, is only visible if the record
   * says when it last spoke.
   */
  async verify(token: string): Promise<AgentToken | null> {
    if (!token.startsWith(TOKEN_PREFIX)) return null;

    const { rows } = await pool.query(
      `UPDATE agent_tokens SET last_used_at = CURRENT_TIMESTAMP
       WHERE token_hash = $1 AND revoked_at IS NULL
       RETURNING id, label, scope, user_id, created_at, last_used_at`,
      [hashToken(token)]
    );
    return rows[0] ?? null;
  }
}

export const agentTokensService = new AgentTokensService();
