import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { skillsService } from "../services/skills.service.js";

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
  if (skills.length === 0) {
    return [
      "# House rules",
      "",
      "None written yet. Add them under Resources → Skills in zaatool and they appear here.",
    ].join("\n");
  }

  const sections = skills.map((skill) => {
    const heading = `## ${skill.name}`;
    const summary = skill.description?.trim() ? `\n_${skill.description.trim()}_\n` : "";
    return `${heading}\n${summary}\n${skill.content?.trim() ?? ""}`.trimEnd();
  });

  return [
    "# House rules",
    "",
    "Conventions for notebooks in this workspace. Follow them unless told otherwise.",
    "",
    ...sections,
  ].join("\n\n");
}

export function registerConventions(server: McpServer): void {
  server.registerResource(
    "conventions",
    CONVENTIONS_URI,
    {
      title: "House rules",
      description:
        "How notebooks are written in this workspace. Read this before writing or changing one.",
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
