import { API_BASE_URL, describeRequestFailure } from './api.js';

/**
 * One row of the audit trail, as `GET /api/audit` returns it.
 *
 * `actor` keeps the engine's own keys (`type`, `user_id`, `username`, `token_id`, `label`,
 * `client`, ...) because which of them exist depends on the kind of actor; the page reads
 * them through `describeActor` rather than assuming any of them.
 */
export interface AuditEvent {
  id: string;
  /** ISO, UTC. */
  at: string;
  /** Dotted, e.g. `notebook.deploy`. */
  action: string;
  outcome: 'success' | 'failure' | 'denied';
  actor: Record<string, string>;
  target: { type: string; id: string | null; ownerId: string | null; name?: string };
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  meta: Record<string, unknown>;
}

export interface AuditPage {
  events: AuditEvent[];
  /** Pass as `before` to get the next, older page; null when there is none. */
  next: string | null;
}

export interface AuditFilters {
  /** Matches the start of the action, so `notebook.` finds every notebook action. */
  action?: string;
  actorType?: string;
  outcome?: string;
  targetId?: string;
}

export const ACTOR_TYPES = ['user', 'agent', 'webhook', 'cron', 'share', 'cli', 'system'] as const;
export const OUTCOMES = ['success', 'failure', 'denied'] as const;

function query(filters: AuditFilters, extra: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...filters, ...extra })) {
    // Blank filters are not filters: an empty `action=` would match nothing useful.
    if (value !== undefined && String(value).trim() !== '') params.set(key, String(value).trim());
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

/** The address the JSONL export is downloaded from, with the filters currently applied. */
export function auditExportUrl(filters: AuditFilters): string {
  return `${API_BASE_URL}/api/audit/export${query(filters, { format: 'jsonl' })}`;
}

export const auditApi = {
  list: async (filters: AuditFilters, before?: string | null, limit = 50): Promise<AuditPage> => {
    let res: Response;
    try {
      res = await fetch(`${API_BASE_URL}/api/audit${query(filters, { limit, before: before ?? undefined })}`);
    } catch (err) {
      throw new Error(describeRequestFailure(err), { cause: err });
    }
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.error ?? `Could not load the audit trail (${res.status})`);
    return {
      events: Array.isArray(body?.events) ? body.events : [],
      next: typeof body?.next === 'string' ? body.next : null,
    };
  },
};

const short = (id: string | undefined) => (id ? id.slice(0, 8) : '');

/**
 * Who did it, as a name and a line of detail. An agent shows its label, the client it
 * reported and the start of its token id, because "claude code" alone does not say which
 * of two tokens with that label acted.
 */
export function describeActor(actor: Record<string, string>): { type: string; name: string; detail: string } {
  const type = actor.type ?? 'unknown';
  switch (type) {
    case 'user':
      return { type, name: actor.username ?? short(actor.user_id) ?? 'unknown', detail: '' };
    case 'agent':
      return {
        type,
        name: actor.label ?? 'agent',
        detail: [actor.client, actor.token_id ? `token ${short(actor.token_id)}` : '']
          .filter(Boolean)
          .join(' · '),
      };
    case 'webhook':
    case 'cron':
      return { type, name: `trigger ${short(actor.trigger_id)}`, detail: '' };
    case 'share':
      return { type, name: `share ${short(actor.share_id)}`, detail: '' };
    case 'cli':
      return { type, name: actor.command ?? 'cli', detail: actor.os_user ?? '' };
    case 'system':
      return { type, name: actor.component ?? 'system', detail: '' };
    default:
      return { type, name: type, detail: '' };
  }
}
