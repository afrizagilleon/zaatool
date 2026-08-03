import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { skillsService } from "../services/skills.service.js";
import { renderFormatReference } from "./notebook-format.js";

/**
 * The house rules, offered to whoever is writing.
 *
 * These used to be "skills": markdown pasted into a prompt by an AI panel this engine
 * ran itself. That panel is gone — an agent harness does the writing now, and it brings
 * its own model, its own memory and its own tools. What it cannot bring is *your*
 * conventions, and that is the part worth keeping.
 *
 * So the same documents are served as an MCP resource instead. Claude, Hermes and
 * anything that connects next read the same rules, which is the only way three
 * different agents produce notebooks that look like they came from one workshop.
 */

const CONVENTIONS_URI = "zaa://conventions";

interface SkillRow {
  name: string;
  description?: string | null;
  content?: string | null;
}

function render(skills: SkillRow[]): string {
  const houseRules =
    skills.length === 0
      ? [
          "# House rules",
          "",
          "None written yet. Add them under Resources → Skills in zaatool and they appear here.",
        ].join("\n")
      : [
          "# House rules",
          "",
          "Conventions for notebooks in this workspace. Follow them unless told otherwise.",
          "",
          ...skills.map((skill) => {
            const heading = `## ${skill.name}`;
            const summary = skill.description?.trim() ? `\n_${skill.description.trim()}_\n` : "";
            return `${heading}\n${summary}\n${skill.content?.trim() ?? ""}`.trimEnd();
          }),
        ].join("\n\n");

  // The format first, the workspace's own rules after. An agent reading this is usually
  // about to write a notebook and needs to know what the file may contain before it
  // needs to know how this workspace likes them written — and an empty Skills list must
  // never leave a reader believing there is nothing to know.
  return [renderFormatReference(), "---", houseRules].join("\n\n");
}

/**
 * The exact text an agent receives.
 *
 * Exported so the Skills screen can show it. A person editing house rules should be able
 * to read what those rules turn into, rather than trusting that they arrive somewhere.
 */
export async function renderConventions(): Promise<string> {
  return render((await skillsService.getAll()) as SkillRow[]);
}

export function registerConventions(server: McpServer): void {
  server.registerResource(
    "conventions",
    CONVENTIONS_URI,
    {
      title: "Notebook format and house rules",
      description:
        "The notebook file format — front matter, cells, inputs, and how an output is rendered as a table, chart, markdown or image — followed by this workspace's own conventions. Read this before writing or changing a notebook.",
      mimeType: "text/markdown",
    },
    async () => {
      const skills = (await skillsService.getAll()) as SkillRow[];
      return {
        contents: [{ uri: CONVENTIONS_URI, mimeType: "text/markdown", text: render(skills) }],
      };
    }
  );
}
