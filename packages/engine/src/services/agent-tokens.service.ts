import { createHash, randomBytes, randomUUID } from "node:crypto";
import { pool } from "../db/connection.js";

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
  created_at: Date;
  last_used_at: Date | null;
}

const TOKEN_PREFIX = "zaa_";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export class AgentTokensService {
  /** Returns the token once. It is never recoverable afterwards — only its hash is kept. */
  async issue(label: string, scope: AgentScope): Promise<{ token: string; record: AgentToken }> {
    const token = `${TOKEN_PREFIX}${randomBytes(32).toString("hex")}`;
    const id = randomUUID();

    const { rows } = await pool.query(
      `INSERT INTO agent_tokens (id, label, scope, token_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING id, label, scope, created_at, last_used_at`,
      [id, label, scope, hashToken(token)]
    );

    return { token, record: rows[0] };
  }

  async list(): Promise<AgentToken[]> {
    const { rows } = await pool.query(
      `SELECT id, label, scope, created_at, last_used_at
       FROM agent_tokens
       WHERE revoked_at IS NULL
       ORDER BY created_at DESC`
    );
    return rows;
  }

  async revoke(id: string): Promise<{ revoked: boolean }> {
    const { rowCount } = await pool.query(
      "UPDATE agent_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE id = $1 AND revoked_at IS NULL",
      [id]
    );
    return { revoked: (rowCount ?? 0) > 0 };
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
       RETURNING id, label, scope, created_at, last_used_at`,
      [hashToken(token)]
    );
    return rows[0] ?? null;
  }
}

export const agentTokensService = new AgentTokensService();
