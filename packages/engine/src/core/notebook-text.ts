import { v4 as uuidv4 } from "uuid";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type {
  NotebookCell,
  NotebookJson,
  NotebookLane,
  NotebookLayoutItem,
  NotebookOutput,
  NotebookOutputRender,
  NotebookParam,
  NotebookParamType,
  NotebookRuntime,
  NotebookStep,
  NotebookTrigger,
  ParallelStep,
} from "@zaa-tool/shared";
import { OUTPUT_RENDERS } from "./notebook-outputs.js";

/**
 * The notebook's text form: the same document, written as markdown.
 *
 * This exists because an agent is now a first-class author. JSON is a poor medium for
 * that — expensive to read, impossible to diff by eye, and it hides the prose that
 * makes a notebook worth having. Markdown is what an agent writes fluently and what
 * you can review over coffee, so it is the wire format for every MCP tool.
 *
 * It is a *projection*, not a second store of record: the database still holds the
 * document. Round-tripping is lossless in meaning, not byte-for-byte — a notebook
 * written by hand comes back normalised.
 *
 * Structure is carried by HTML comments rather than by heading levels, because a note
 * is arbitrary markdown and may contain headings and fenced code of its own. A comment
 * is unambiguous, and invisible once rendered.
 *
 *     ---
 *     name: invoice-intake
 *     runtime: node
 *     outputs: [total]
 *     ---
 *
 *     <!-- zaa:cell id=7f3a -->
 *     Fetch the invoice. We only need the total.
 *
 *     <!-- zaa:code -->
 *     ```js
 *     return { invoice: await res.json() };
 *     ```
 *
 * Lives in the engine rather than in `shared` because `shared` holds types only, and
 * only the engine needs to speak this — the browser edits the document directly.
 */

export class NotebookTextError extends Error {
  constructor(readonly issues: string[]) {
    super(issues.join("; "));
    this.name = "NotebookTextError";
  }
}

const DEFAULT_VERSION = "1.0";
export const PARAM_TYPES: readonly NotebookParamType[] = ["string", "number", "boolean", "json"];
const FENCE_LANGUAGE: Record<NotebookRuntime, string> = { node: "js", python: "python" };

// ── writing ───────────────────────────────────────────────────────────────────

export function toMarkdown(notebook: NotebookJson): string {
  const meta: Record<string, unknown> = {
    name: notebook.name,
    runtime: notebook.runtime,
    id: notebook.id,
    version: notebook.version || DEFAULT_VERSION,
  };
  if (notebook.secrets?.length) meta.secrets = notebook.secrets;
  if (notebook.inputs?.length) meta.inputs = notebook.inputs;
  if (notebook.outputs?.length) meta.outputs = notebook.outputs;
  if (notebook.triggers?.length) meta.triggers = notebook.triggers;
  if (notebook.layout?.length) meta.layout = notebook.layout;

  const body: string[] = [];
  writeSteps(notebook.steps ?? [], notebook.runtime, body);

  const front = stringifyYaml(meta, { lineWidth: 0 });
  return `---\n${front}---\n\n${body.join("\n").replace(/\n{3,}$/, "\n")}`;
}

function writeSteps(steps: NotebookStep[], runtime: NotebookRuntime, out: string[]): void {
  for (const step of steps) {
    if (step.kind === "parallel") {
      out.push(marker("parallel", { id: step.id }), "");
      for (const lane of step.lanes ?? []) {
        out.push(marker("lane", { id: lane.id, label: lane.label }), "");
        writeSteps(lane.steps ?? [], runtime, out);
      }
      out.push(marker("end", {}), "");
      continue;
    }

    out.push(
      marker("cell", {
        id: step.id,
        timeout: step.timeoutMs,
        fold: foldValue(step.collapsed),
      }),
      ""
    );

    if (step.note?.trim()) out.push(step.note.replace(/\s+$/, ""), "");

    if (step.code !== undefined) {
      const fence = fenceFor(step.code);
      out.push(marker("code", {}), "");
      out.push(`${fence}${FENCE_LANGUAGE[runtime] ?? ""}`);
      if (step.code !== "") out.push(step.code.replace(/\n+$/, ""));
      out.push(fence, "");
    }
  }
}

function marker(name: string, attrs: Record<string, unknown>): string {
  const parts = [`zaa:${name}`];
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === "") continue;
    const text = String(value);
    parts.push(
      /[\s"\\]/.test(text)
        ? `${key}="${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
        : `${key}=${text}`
    );
  }
  return `<!-- ${parts.join(" ")} -->`;
}

function foldValue(collapsed: NotebookCell["collapsed"]): string | undefined {
  if (!collapsed) return undefined;
  const folded = (["note", "code", "output"] as const).filter((part) => collapsed[part]);
  return folded.length > 0 ? folded.join(",") : undefined;
}

/**
 * A fence long enough to survive its own contents — code holding a triple backtick,
 * such as a template literal or an embedded markdown sample, would otherwise close the
 * block early and silently truncate.
 */
function fenceFor(code: string): string {
  let longest = 0;
  for (const run of code.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  return "`".repeat(Math.max(3, longest + 1));
}

// ── reading ───────────────────────────────────────────────────────────────────

interface Token {
  kind: "marker" | "fence" | "text";
  start: number;
  end: number;
  name?: string;
  attrs?: Record<string, string>;
  content?: string;
}

/**
 * Parses the text form back into a document.
 *
 * Deliberately forgiving where an omission is unambiguous — a missing id is generated,
 * a missing runtime is `node`, and a body with no markers at all is read as a single
 * cell, because that is what an agent writes when asked for something small. Strict
 * everywhere a guess would be a decision: unmatched structure and unknown types are
 * refused with the reason.
 *
 * Ids are preserved when present, and that matters more than it looks: run history and
 * staleness are keyed by cell id, so an agent that rewrites a notebook while keeping
 * ids keeps its history, and one that drops them starts the record over.
 */
export interface FromMarkdownOptions {
  /** Used when the text carries no `id`, so an update does not become a new notebook. */
  id?: string;
  /**
   * The stored document this text is replacing.
   *
   * Identity the text does not spell out is adopted from here rather than reinvented.
   * That matters most for a webhook's slug: the slug *is* the credential, so a rewrite
   * that omits it must keep the existing URL working instead of quietly issuing a new
   * one and breaking every caller.
   */
  previous?: NotebookJson;
}

export function fromMarkdown(text: string, options?: FromMarkdownOptions): NotebookJson {
  const issues: string[] = [];
  const source = text.replace(/\r\n/g, "\n");

  const { meta, bodyOffset } = readFrontMatter(source, issues);
  if (issues.length > 0) throw new NotebookTextError(issues);

  const name = typeof meta.name === "string" ? meta.name.trim() : "";
  if (!name) issues.push("front matter must set `name`");

  const runtime = readRuntime(meta.runtime, issues);
  const lines = source.split("\n").slice(bodyOffset);
  const steps = readSteps(lines, issues);

  const notebook: NotebookJson = {
    version: typeof meta.version === "string" ? meta.version : DEFAULT_VERSION,
    id: typeof meta.id === "string" && meta.id ? meta.id : options?.id || uuidv4(),
    name,
    runtime,
    steps,
  };

  const secrets = readStringList(meta.secrets, "secrets", issues);
  if (secrets.length > 0) notebook.secrets = secrets;

  const outputs = readOutputs(meta.outputs, issues);
  if (outputs.length > 0) notebook.outputs = outputs;

  const inputs = readInputs(meta.inputs, issues);
  if (inputs.length > 0) notebook.inputs = inputs;

  const layout = readLayout(meta.layout, issues);
  if (layout.length > 0) notebook.layout = layout;

  const triggers = readTriggers(meta.triggers, issues, options?.previous?.triggers);
  if (triggers.length > 0) notebook.triggers = triggers;

  if (issues.length > 0) throw new NotebookTextError(issues);
  return notebook;
}

function readFrontMatter(
  source: string,
  issues: string[]
): { meta: Record<string, unknown>; bodyOffset: number } {
  const lines = source.split("\n");
  let start = 0;
  while (start < lines.length && lines[start].trim() === "") start += 1;

  if (lines[start]?.trim() !== "---") {
    issues.push("the document must open with a `---` front matter block");
    return { meta: {}, bodyOffset: 0 };
  }

  let end = start + 1;
  while (end < lines.length && lines[end].trim() !== "---") end += 1;
  if (end >= lines.length) {
    issues.push("the front matter block is never closed with `---`");
    return { meta: {}, bodyOffset: 0 };
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(lines.slice(start + 1, end).join("\n"));
  } catch (err) {
    issues.push(`front matter is not valid YAML: ${(err as Error).message}`);
    return { meta: {}, bodyOffset: end + 1 };
  }

  if (parsed !== null && (typeof parsed !== "object" || Array.isArray(parsed))) {
    issues.push("front matter must be a set of key/value pairs");
    return { meta: {}, bodyOffset: end + 1 };
  }

  return { meta: (parsed as Record<string, unknown>) ?? {}, bodyOffset: end + 1 };
}

function readRuntime(value: unknown, issues: string[]): NotebookRuntime {
  if (value === undefined || value === null) return "node";
  if (value === "node" || value === "python") return value;
  issues.push(`\`runtime\` must be "node" or "python", got ${JSON.stringify(value)}`);
  return "node";
}

function readStringList(value: unknown, field: string, issues: string[]): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    issues.push(`\`${field}\` must be a list`);
    return [];
  }
  const list: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string" && entry.trim()) list.push(entry.trim());
    else issues.push(`\`${field}\` must contain names, got ${JSON.stringify(entry)}`);
  }
  return list;
}

/**
 * Reads the page arrangement.
 *
 * Every field is required and numeric, because a half-written tile has no sensible
 * default position — silently placing it somewhere would look like the arrangement was
 * kept when it was not.
 */
function readLayout(value: unknown, issues: string[]): NotebookLayoutItem[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    issues.push("`layout` must be a list");
    return [];
  }

  const items: NotebookLayoutItem[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      issues.push(`each layout item must be a mapping, got ${JSON.stringify(entry)}`);
      continue;
    }
    const raw = entry as Record<string, unknown>;
    const name = typeof raw.i === "string" ? raw.i.trim() : "";
    if (!name) {
      issues.push("each layout item needs `i`, the name of the output it places");
      continue;
    }

    const numbers = (["x", "y", "w", "h"] as const).map((key) => raw[key]);
    if (!numbers.every((one) => typeof one === "number" && Number.isFinite(one))) {
      issues.push(`layout item "${name}" needs numeric x, y, w and h`);
      continue;
    }

    const [x, y, w, h] = numbers as number[];
    items.push({ i: name, x, y, w, h });
  }
  return items;
}

/**
 * Reads the declared outputs, in either form.
 *
 * A bare name stays a bare name. Most notebooks never say anything about presentation,
 * and rewriting `outputs: [sum]` into `outputs: [{name: sum}]` on every save would churn
 * documents to record a fact nobody stated.
 */
function readOutputs(value: unknown, issues: string[]): Array<string | NotebookOutput> {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    issues.push("`outputs` must be a list");
    return [];
  }

  const outputs: Array<string | NotebookOutput> = [];
  for (const entry of value) {
    if (typeof entry === "string") {
      if (entry.trim()) outputs.push(entry.trim());
      else issues.push("an output name is empty");
      continue;
    }

    if (typeof entry === "object" && entry !== null && !Array.isArray(entry)) {
      const raw = entry as Record<string, unknown>;
      const name = typeof raw.name === "string" ? raw.name.trim() : "";
      if (!name) {
        issues.push("each output needs a `name`");
        continue;
      }

      const output: NotebookOutput = { name };
      if (typeof raw.description === "string" && raw.description) {
        output.description = raw.description;
      }
      if (raw.render !== undefined) {
        if (!OUTPUT_RENDERS.includes(raw.render as NotebookOutputRender)) {
          issues.push(
            `output "${name}" has render ${JSON.stringify(raw.render)}; expected one of ${OUTPUT_RENDERS.join(", ")}`
          );
        } else if (raw.render !== "auto") {
          // `auto` is the absence of an instruction, so it is not written down.
          output.render = raw.render as NotebookOutputRender;
        }
      }
      if (typeof raw.x === "string" && raw.x) output.x = raw.x;

      outputs.push(output);
      continue;
    }

    issues.push(`each output must be a name or a mapping, got ${JSON.stringify(entry)}`);
  }

  return outputs;
}

/**
 * Reads the permitted values for an input.
 *
 * Accepts both a bare value and `{ value, label }`, and keeps whichever form was
 * written — round-tripping a document must not quietly rewrite how its author chose to
 * express a list.
 */
function readOptions(
  paramName: string,
  value: unknown,
  issues: string[]
): NotebookParam["options"] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    issues.push(`input "${paramName}" has \`options\` that is not a list`);
    return undefined;
  }

  const options: NonNullable<NotebookParam["options"]> = [];
  for (const entry of value) {
    if (typeof entry === "string" || typeof entry === "number") {
      options.push(entry);
      continue;
    }
    if (typeof entry === "object" && entry !== null && !Array.isArray(entry)) {
      const raw = entry as Record<string, unknown>;
      if (typeof raw.value === "string" || typeof raw.value === "number") {
        options.push(
          typeof raw.label === "string" && raw.label
            ? { value: raw.value, label: raw.label }
            : { value: raw.value }
        );
        continue;
      }
    }
    issues.push(`input "${paramName}" has an option that is not a value: ${JSON.stringify(entry)}`);
  }

  return options.length > 0 ? options : undefined;
}

function readInputs(value: unknown, issues: string[]): NotebookParam[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    issues.push("`inputs` must be a list");
    return [];
  }

  const params: NotebookParam[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      issues.push(`each input must be a mapping, got ${JSON.stringify(entry)}`);
      continue;
    }
    const raw = entry as Record<string, unknown>;
    const paramName = typeof raw.name === "string" ? raw.name.trim() : "";
    if (!paramName) {
      issues.push("each input needs a `name`");
      continue;
    }
    if (!PARAM_TYPES.includes(raw.type as NotebookParamType)) {
      issues.push(
        `input "${paramName}" has type ${JSON.stringify(raw.type)}; expected one of ${PARAM_TYPES.join(", ")}`
      );
      continue;
    }

    const param: NotebookParam = { name: paramName, type: raw.type as NotebookParamType };
    if (raw.required === true) param.required = true;
    if (typeof raw.description === "string" && raw.description) param.description = raw.description;
    if (raw.default !== undefined) param.default = raw.default;

    const options = readOptions(paramName, raw.options, issues);
    if (options) {
      param.options = options;
      if (raw.multiple === true) param.multiple = true;
    } else if (raw.multiple === true) {
      // Without a fixed set there is nothing to pick several of, and silently keeping the
      // flag would let a page render a chooser with no choices in it.
      issues.push(`input "${paramName}" is \`multiple\` but declares no \`options\``);
    }

    params.push(param);
  }
  return params;
}

/**
 * Reads the trigger list, keeping the identity of the ones that were already there.
 *
 * A trigger written without an id is matched to a stored one — by expression or slug
 * where the text says enough, otherwise by position among triggers of the same kind.
 * Without this, rewriting a notebook would mint a new webhook slug every time, and the
 * URL you handed out last week would stop answering.
 */
function readTriggers(
  value: unknown,
  issues: string[],
  previous: NotebookTrigger[] = []
): NotebookTrigger[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    issues.push("`triggers` must be a list");
    return [];
  }

  const priorCrons = previous.filter((trigger) => trigger.kind === "cron");
  const priorHooks = previous.filter((trigger) => trigger.kind === "webhook");
  const claimed = new Set<string>();
  let cronPosition = 0;
  let hookPosition = 0;

  /** The first candidate whose identity is not already taken by an earlier entry. */
  const take = <T extends NotebookTrigger>(...candidates: (T | undefined)[]): T | undefined => {
    for (const candidate of candidates) {
      if (candidate && !claimed.has(candidate.id)) {
        claimed.add(candidate.id);
        return candidate;
      }
    }
    return undefined;
  };

  const triggers: NotebookTrigger[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      issues.push(`each trigger must be a mapping, got ${JSON.stringify(entry)}`);
      continue;
    }
    const raw = entry as Record<string, unknown>;
    const statedId = typeof raw.id === "string" && raw.id ? raw.id : undefined;

    if (raw.kind === "cron") {
      const cron = typeof raw.cron === "string" ? raw.cron.trim() : "";
      if (!cron) {
        issues.push("a cron trigger needs a `cron` expression");
        continue;
      }
      const match = take(
        statedId ? priorCrons.find((prior) => prior.id === statedId) : undefined,
        priorCrons.find((prior) => prior.kind === "cron" && prior.cron === cron),
        priorCrons[cronPosition]
      );
      cronPosition += 1;

      const trigger: NotebookTrigger = { id: statedId ?? match?.id ?? uuidv4(), kind: "cron", cron };
      if (raw.enabled !== undefined) trigger.enabled = raw.enabled !== false;
      triggers.push(trigger);
      continue;
    }

    if (raw.kind === "webhook") {
      const statedSlug = typeof raw.slug === "string" && raw.slug.trim() ? raw.slug.trim() : undefined;
      const match = take(
        statedId ? priorHooks.find((prior) => prior.id === statedId) : undefined,
        statedSlug
          ? priorHooks.find((prior) => prior.kind === "webhook" && prior.slug === statedSlug)
          : undefined,
        statedSlug ? undefined : priorHooks[hookPosition]
      );
      hookPosition += 1;

      const trigger: NotebookTrigger = {
        id: statedId ?? match?.id ?? uuidv4(),
        kind: "webhook",
        // The slug is the credential, so a new one is unguessable rather than memorable
        // — and an existing one is inherited rather than replaced.
        slug: statedSlug ?? (match?.kind === "webhook" ? match.slug : undefined) ?? uuidv4(),
      };
      if (typeof raw.secretKey === "string" && raw.secretKey.trim()) {
        trigger.secretKey = raw.secretKey.trim();
      }
      if (raw.enabled !== undefined) trigger.enabled = raw.enabled !== false;
      triggers.push(trigger);
      continue;
    }

    issues.push(`a trigger's \`kind\` must be "cron" or "webhook", got ${JSON.stringify(raw.kind)}`);
  }
  return triggers;
}

// ── body ──────────────────────────────────────────────────────────────────────

/**
 * Splits the body into markers, fenced blocks and plain lines.
 *
 * Fences are consumed whole, which is what keeps a marker written inside a code sample
 * from being read as structure — and equally, keeps a note's own fenced examples intact.
 */
function tokenize(lines: string[]): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    const asMarker = /^\s*<!--\s*zaa:([a-z]+)\s*(.*?)\s*-->\s*$/.exec(line);
    if (asMarker) {
      tokens.push({
        kind: "marker",
        start: index,
        end: index,
        name: asMarker[1],
        attrs: parseAttributes(asMarker[2]),
      });
      index += 1;
      continue;
    }

    const asFence = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (asFence) {
      const closing = new RegExp(`^\\s{0,3}\\${asFence[1][0]}{${asFence[1].length},}\\s*$`);
      const content: string[] = [];
      let cursor = index + 1;
      while (cursor < lines.length && !closing.test(lines[cursor])) {
        content.push(lines[cursor]);
        cursor += 1;
      }
      tokens.push({
        kind: "fence",
        start: index,
        end: Math.min(cursor, lines.length - 1),
        content: content.join("\n"),
      });
      index = cursor + 1;
      continue;
    }

    tokens.push({ kind: "text", start: index, end: index });
    index += 1;
  }

  return tokens;
}

function parseAttributes(text: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of text.matchAll(/([a-zA-Z]+)=("((?:[^"\\]|\\.)*)"|\S+)/g)) {
    attrs[match[1]] = match[3] !== undefined ? match[3].replace(/\\(.)/g, "$1") : match[2];
  }
  return attrs;
}

/** One level of the structure being built: where cells land, and what closes it. */
interface Frame {
  container: NotebookStep[] | null;
  parallel?: ParallelStep;
  lane?: NotebookLane;
}

function readSteps(lines: string[], issues: string[]): NotebookStep[] {
  const tokens = tokenize(lines);
  // Any marker at all means the author is using the syntax, so a lone `zaa:lane` is a
  // mistake to report rather than prose to reinterpret.
  if (!tokens.some((token) => token.kind === "marker")) return readImplicitCell(lines, tokens);

  const steps: NotebookStep[] = [];
  const frames: Frame[] = [{ container: steps }];

  let cell: NotebookCell | null = null;
  let noteFrom = -1;
  let noteTo = -1;
  let awaitingCode = false;

  const flushNote = () => {
    if (cell && noteFrom >= 0) {
      const note = lines.slice(noteFrom, noteTo + 1).join("\n").trim();
      if (note) cell.note = note;
    }
    noteFrom = -1;
    noteTo = -1;
  };

  const closeCell = () => {
    flushNote();
    if (cell && awaitingCode && cell.code === undefined) cell.code = "";
    cell = null;
    awaitingCode = false;
  };

  const top = () => frames[frames.length - 1];

  for (const token of tokens) {
    if (token.kind === "marker" && token.name === "code") {
      if (!cell) {
        issues.push("a `zaa:code` block appears before any cell");
        continue;
      }
      flushNote();
      awaitingCode = true;
      continue;
    }

    if (token.kind === "marker") {
      closeCell();

      switch (token.name) {
        case "cell": {
          const container = top().container;
          if (!container) {
            issues.push("a cell sits directly inside a parallel group; put it in a lane");
            break;
          }
          cell = { id: token.attrs?.id || uuidv4(), kind: "cell" };
          const timeout = Number(token.attrs?.timeout);
          if (Number.isFinite(timeout) && timeout > 0) cell.timeoutMs = timeout;
          const fold = readFold(token.attrs?.fold);
          if (fold) cell.collapsed = fold;
          container.push(cell);
          break;
        }

        case "parallel": {
          const container = top().container;
          if (!container) {
            issues.push("a parallel group sits directly inside another; put it in a lane");
            break;
          }
          const group: ParallelStep = {
            id: token.attrs?.id || uuidv4(),
            kind: "parallel",
            lanes: [],
          };
          container.push(group);
          frames.push({ container: null, parallel: group });
          break;
        }

        case "lane": {
          const frame = top();
          if (!frame.parallel) {
            issues.push("a lane appears outside a parallel group");
            break;
          }
          const lane: NotebookLane = { id: token.attrs?.id || uuidv4(), steps: [] };
          if (token.attrs?.label) lane.label = token.attrs.label;
          frame.parallel.lanes.push(lane);
          frame.container = lane.steps;
          frame.lane = lane;
          break;
        }

        case "end": {
          const frame = top();
          if (!frame.parallel) {
            issues.push("a `zaa:end` appears with no parallel group open");
            break;
          }
          if (frame.parallel.lanes.length === 0) {
            issues.push(`parallel group ${frame.parallel.id} has no lanes`);
          }
          for (const lane of frame.parallel.lanes) {
            if (lane.steps.length === 0) {
              issues.push(`lane "${lane.label ?? lane.id}" has no cells`);
            }
          }
          frames.pop();
          break;
        }

        default:
          issues.push(`unknown marker \`zaa:${token.name}\``);
      }
      continue;
    }

    if (!cell) continue;

    if (awaitingCode) {
      if (token.kind === "fence") {
        cell.code = token.content ?? "";
        awaitingCode = false;
      } else if (lines[token.start].trim() !== "") {
        issues.push(`cell ${cell.id} has text between \`zaa:code\` and its code block`);
      }
      continue;
    }

    if (cell.code !== undefined) {
      if (lines[token.start].trim() !== "") {
        issues.push(`cell ${cell.id} has content after its code block`);
      }
      continue;
    }

    if (noteFrom < 0) noteFrom = token.start;
    noteTo = token.end;
  }

  closeCell();

  for (const frame of frames.slice(1)) {
    issues.push(`parallel group ${frame.parallel?.id} is never closed with \`zaa:end\``);
  }

  return steps;
}

/**
 * A body with no markers is the shape an agent reaches for first: some prose, then one
 * code block. Reading it as a single cell means the simplest possible write works
 * without teaching the agent the marker syntax.
 */
function readImplicitCell(lines: string[], tokens: Token[]): NotebookStep[] {
  const fence = tokens.find((token) => token.kind === "fence");
  const noteEnd = fence ? fence.start : lines.length;
  const note = lines.slice(0, noteEnd).join("\n").trim();

  if (!note && !fence) return [];

  const cell: NotebookCell = { id: uuidv4(), kind: "cell" };
  if (note) cell.note = note;
  if (fence) cell.code = fence.content ?? "";
  return [cell];
}

function readFold(value: string | undefined): NotebookCell["collapsed"] | undefined {
  if (!value) return undefined;
  const folded: NotebookCell["collapsed"] = {};
  let any = false;
  for (const part of value.split(",")) {
    const key = part.trim();
    if (key === "note" || key === "code" || key === "output") {
      folded[key] = true;
      any = true;
    }
  }
  return any ? folded : undefined;
}
