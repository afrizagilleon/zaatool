import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Asking before doing something that reaches past the workspace.
 *
 * Almost nothing an agent does here needs asking about, and that is the deploy gate's
 * doing: writing changes a draft, and triggers run the deployed version, so an agent
 * cannot reach production by writing at all. What is left is destroying work, which no
 * gate protects you from.
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

