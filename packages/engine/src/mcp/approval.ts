import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { NotebookJson, NotebookTrigger } from "@zaa-tool/shared";

/**
 * Asking before doing something that reaches past the workspace.
 *
 * Most of what an agent does here is safe by construction: a draft nobody triggers is
 * just text, and running a cell is what it is for. Two things are not — deleting work,
 * and changing a notebook the outside world can already reach. Those get a question.
 *
 * MCP's `elicitation/create` is what carries it. Hermes routes form elicitations to its
 * approval surface, so in practice this is a pair of buttons in Telegram; a client
 * without the capability falls back to an explicit argument, which keeps the guard
 * real rather than optional.
 *
 * This is a courtesy, not the security boundary. The boundary is that no tool deploys
 * anything — see `notebook-tools.ts`.
 */

export type ApprovalOutcome =
  | { approved: true }
  | { approved: false; reason: string };

function supportsElicitation(server: McpServer): boolean {
  return Boolean(server.server.getClientCapabilities()?.elicitation);
}

/**
 * Puts the question to whoever is on the other end.
 *
 * `fallbackGiven` is the caller's own confirmation — a name typed again, a flag set —
 * used when the client cannot ask a person. Refusing outright in that case would make
 * the tool unusable from a plain client; accepting silently would make the guard a
 * decoration.
 */
export async function requestApproval(
  server: McpServer,
  request: { summary: string; consequence: string; fallbackGiven: boolean; fallbackHint: string }
): Promise<ApprovalOutcome> {
  if (!supportsElicitation(server)) {
    return request.fallbackGiven
      ? { approved: true }
      : { approved: false, reason: `${request.consequence} ${request.fallbackHint}` };
  }

  let result;
  try {
    result = await server.server.elicitInput({
      message: `${request.summary}\n\n${request.consequence}`,
      requestedSchema: {
        type: "object",
        properties: {
          approve: {
            type: "boolean",
            title: "Approve",
            description: request.consequence,
          },
        },
        required: ["approve"],
      },
    });
  } catch (err: unknown) {
    // A client that advertises elicitation and then fails to deliver leaves the answer
    // unknown, and unknown is not yes.
    return { approved: false, reason: `Could not ask for approval: ${(err as Error).message}` };
  }

  if (result.action !== "accept") {
    return { approved: false, reason: "Declined." };
  }
  if (result.content?.approve !== true) {
    return { approved: false, reason: "Not approved." };
  }
  return { approved: true };
}

function describeTrigger(trigger: NotebookTrigger): string {
  return trigger.kind === "cron"
    ? `cron \`${trigger.cron}\``
    : `webhook POST /hooks/${trigger.slug}`;
}

const isLive = (trigger: NotebookTrigger): boolean => trigger.enabled !== false;

/**
 * What a save would change about the world outside the editor.
 *
 * Everything else — prose, code, contracts — is between you and the document. These are
 * the changes that alter what runs unattended, which today happens the moment a
 * notebook is saved, since there is no deployed version to sit behind. When that gate
 * exists this list gets shorter, not longer.
 */
export function outwardChanges(before: NotebookJson | null, after: NotebookJson): string[] {
  const changes: string[] = [];
  const previous = new Map((before?.triggers ?? []).map((trigger) => [trigger.id, trigger]));
  const next = new Map((after.triggers ?? []).map((trigger) => [trigger.id, trigger]));

  for (const [id, trigger] of next) {
    const was = previous.get(id);
    if (!was && isLive(trigger)) {
      changes.push(`adds a live ${describeTrigger(trigger)}`);
    } else if (was && !isLive(was) && isLive(trigger)) {
      changes.push(`enables ${describeTrigger(trigger)}`);
    } else if (was && was.kind === "cron" && trigger.kind === "cron" && was.cron !== trigger.cron && isLive(trigger)) {
      changes.push(`reschedules ${describeTrigger(was)} to \`${trigger.cron}\``);
    }
  }

  for (const [id, trigger] of previous) {
    if (!next.has(id) && isLive(trigger)) {
      changes.push(`removes the live ${describeTrigger(trigger)}`);
    }
  }

  // Changing the code of something already running unattended is the quiet one: no
  // trigger changed, but what fires at 9am tomorrow just became different.
  if (changes.length === 0 && (before?.triggers ?? []).some(isLive)) {
    const running = (before?.triggers ?? []).filter(isLive).map(describeTrigger).join(", ");
    changes.push(`changes a notebook that is already live (${running})`);
  }

  return changes;
}
