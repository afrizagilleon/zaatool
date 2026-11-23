/**
 * Notebook document contract.
 *
 * A notebook is a linear sequence of steps. Parallelism is expressed by a
 * structured `parallel` step containing lanes, never by free-form edges — fork
 * and join are implied by the structure, so a notebook is always a valid DAG and
 * can never contain a cycle.
 *
 * Deliberately absent: any field holding execution results. A notebook document
 * is a definition. Outputs belong to a run, so a saved notebook can never show
 * results from a previous session.
 */

import type { NotebookRunStatus } from "./notebook-run.js";

/** One notebook, one language. Values crossing a cell boundary must be JSON. */
export type NotebookRuntime = "node" | "python";

/**
 * One unit of work: the note explaining it, the code implementing it, and (at
 * run time, never in the document) that code's output.
 *
 * Both parts are optional, which covers what used to need two cell kinds: a
 * note alone is a heading or explanation, code alone is a plain step, and
 * together they keep intent and implementation from drifting apart. The note is
 * also the spec an AI assistant reads when writing or revising this cell's code.
 */
/** Which parts of a cell are folded away. */
export interface CellFolding {
  note?: boolean;
  code?: boolean;
  output?: boolean;
}

/**
 * Who last changed a cell, and when.
 *
 * Stamped by the engine from the identity that authenticated the write — a person's
 * username, or the label on an agent's token. Never taken from the request body, so it
 * cannot be claimed.
 */
export interface CellAuthor {
  by: string;
  at: string;
}

export interface NotebookCell {
  id: string;
  kind: "cell";
  /** Set by the server on save; absent on cells written before this existed. */
  author?: CellAuthor;
  note?: string;
  /** Whatever the code returns is merged into the notebook scope by name. */
  code?: string;
  timeoutMs?: number;
  /**
   * Authoring state, persisted deliberately: how a long notebook is folded is
   * part of how its author arranged it, the same way a canvas stored viewport.
   * This is not a result — the rule that outputs never enter the document holds.
   */
  collapsed?: CellFolding;
}

export interface NotebookLane {
  id: string;
  label?: string;
  steps: NotebookStep[];
}

/**
 * Lanes execute concurrently. Each lane reads the shared scope but writes only
 * to its own; those writes are merged back when every lane has finished.
 */
export interface ParallelStep {
  id: string;
  kind: "parallel";
  lanes: NotebookLane[];
}

export type NotebookStep = NotebookCell | ParallelStep;

/**
 * Triggers belong to the notebook, not to a cell.
 *
 * A trigger is the reason a run starts, not a step of the computation. Modelling it
 * as a cell made the first cell a special case everywhere — the canvas did that with
 * `trigger:cron` nodes, which forced the scheduler to scan every graph's contents once
 * a minute. As notebook metadata they are indexed and simply queried.
 */
export interface CronTrigger {
  id: string;
  kind: "cron";
  /** Five-field expression: minute hour day-of-month month day-of-week. */
  cron: string;
  enabled?: boolean;
}

export interface WebhookTrigger {
  id: string;
  kind: "webhook";
  /** Path segment of the public URL. Unguessable by default. */
  slug: string;
  /**
   * Name of a row in the secrets store whose value must be sent as
   * `X-Webhook-Secret`. Referenced rather than inlined so no credential is
   * stored in the notebook document.
   */
  secretKey?: string;
  enabled?: boolean;
}

export type NotebookTrigger = CronTrigger | WebhookTrigger;

/** How a notebook gets started, named on its own so a list can group by it. */
export type NotebookTriggerKind = NotebookTrigger["kind"];

/**
 * The reuse boundary.
 *
 * Inside a notebook, dependencies stay implicit through shared scope — that is what
 * makes it readable top to bottom. The moment another notebook calls this one, that
 * scope becomes an interface, and an interface nobody wrote down is one nobody can
 * change safely. So a contract is explicit, and only here.
 *
 * Both halves are optional: a notebook with no declared inputs takes no arguments,
 * and one with no declared outputs returns nothing to a caller. Neither prevents it
 * from being run on its own.
 */
/**
 * `file` is the one that is not a scalar, and it earns its place because the alternative
 * is worse: without it, sending a photo to a notebook means base64 inside a JSON string,
 * which is a 33% larger body, an unreadable cell, and no way for a page to draw a picker.
 *
 * A file's *value* is the descriptor the engine hands back after it has stored the bytes —
 * `{ name, path, url, size, mime }`. A cell receives it wrapped, with `readAsText()` and
 * friends; a page renders it as an image or a link. Nothing anywhere passes the bytes
 * themselves through the contract.
 *
 * Written as an array first and a type second, because the editor needs the *values* at
 * run time to draw a dropdown and a union type gives it none. It was written twice
 * instead — once here as a type, once in `ContractPanel` as a list — and the two drifted
 * for four milestones: `file` existed in the engine, in the compiler, in the page
 * renderer and in the agent's tool schema, and could not be chosen in the editor. Nothing
 * failed, because nothing compared them.
 */
export const PARAM_TYPES = ["string", "number", "boolean", "json", "file"] as const;

export type NotebookParamType = (typeof PARAM_TYPES)[number];

/**
 * One permitted value, optionally with a label to show a person instead.
 *
 * A bare string is the same thing with the label left off, which is what most choices
 * are — `"usd_to_idr"` needs no translation for the machine and a label only when a
 * human has to pick it out of a list.
 */
export interface NotebookParamOption {
  value: string | number;
  label?: string;
}

export interface NotebookParam {
  name: string;
  type: NotebookParamType;
  /** Without a default, a missing required value is an error before anything runs. */
  required?: boolean;
  description?: string;
  default?: unknown;
  /**
   * The values this input accepts, when there is a fixed set of them.
   *
   * Declared rather than described in prose, because the same list has four readers: the
   * page renders a select, the agent's tool schema becomes an enum, and the contract
   * refuses anything else before a webhook or a caller starts a run. A sentence saying
   * "either 'a' or 'b'" only reaches the one reader who reads sentences.
   *
   * Only meaningful for `string` and `number`.
   */
  options?: Array<string | number | NotebookParamOption>;
  /** With `options`, accepts a list of them rather than one. The value becomes an array. */
  multiple?: boolean;
  /**
   * Room to write in. `string` only, and it is still a `string` — this changes the
   * control, not the type.
   *
   * A one-line box is a promise about length, and it was the wrong one for a note, a
   * reason, or a prompt. It cannot be inferred: an empty default says nothing about how
   * much someone is about to type, so this is the one presentation fact only the author
   * knows. `json` already gets room, because JSON is never one line worth having.
   */
  multiline?: boolean;
  /**
   * What kinds of file this input takes — `file` only.
   *
   * The same words a browser's `accept` attribute takes, because that is where it is
   * going: `"image/*"`, `"audio/*"`, `".csv,.xlsx"`. It is a hint, not a guard; the
   * notebook still has to cope with whatever arrives, since a webhook does not consult a
   * file picker.
   *
   * It earns its place for one reason beyond the picker: an input that says `audio/*`
   * gets a record button, and there is no other way for a page to know that asking for a
   * voice note is what this notebook meant.
   */
  accept?: string;
}

/**
 * A stored file, as it travels through the contract.
 *
 * Never the bytes. `path` is the identity, `url` is signed and expires, and neither one
 * says anything about where this engine keeps its disk.
 */
export interface NotebookFile {
  name: string;
  path: string;
  url: string;
  size: number;
  mime: string;
}

/**
 * How an output is shown.
 *
 * `auto` is not a fallback, it is the intended default: the value's own shape decides.
 * An array of objects is a table whether or not anyone said so, and a notebook written
 * by an agent that never thought about presentation still gets a usable page.
 *
 * The vocabulary is deliberately this short, and nothing here configures a renderer.
 * A table's columns come from the data; its paging, search and sorting are always on
 * because nobody ever wanted them off. The old dashboard's `tableConfig`/`chartConfig`
 * are what happens when presentation becomes a second thing to declare and keep in step.
 *
 * The exception, and the reason it is one: `bar`, `line`, `area` and `pie` are not four
 * skins on a chart, they are four different questions. Pie asks what share of a whole,
 * line asks how something changed, bar asks which is bigger. Only the person writing the
 * notebook knows which they are asking — so the *form* is declarable while every
 * appearance choice around it (colour, axes, grid, labels) stays fixed. `chart` remains
 * as "you pick for me".
 */
export const OUTPUT_RENDERS = [
  "auto",
  "text",
  "markdown",
  "table",
  "chart",
  "bar",
  "line",
  "area",
  "pie",
  "image",
  "video",
  "audio",
  "file",
  "json",
] as const;

export type NotebookOutputRender = (typeof OUTPUT_RENDERS)[number];

export interface NotebookOutput {
  name: string;
  description?: string;
  render?: NotebookOutputRender;
  /** Chart only: the column along the bottom. Defaults to the first non-numeric one. */
  x?: string;
}

/**
 * A button on a page.
 *
 * Three kinds, and the list is meant to stay three. Each one is a verb someone can
 * already perform another way — run this again, run something else, go there — so a
 * button never introduces behaviour, only a shorter path to it. That is the line that
 * keeps this from becoming a widget language.
 *
 * `run` is deliberately fire-and-forget: it reports that the other notebook succeeded or
 * failed and shows nothing it returned. A button that displayed results would need
 * somewhere to put them, and then a page would be showing two notebooks at once with no
 * way to say which value came from where.
 */
export type NotebookActionKind = "rerun" | "run" | "link";

export interface NotebookAction {
  /** What the button says. Required — an unlabelled button is a guess. */
  label: string;
  do: NotebookActionKind;
  /**
   * `run` only: the notebook to call, by name or id. It must be deployed, for the same
   * reason a page serves the deployed version — a button is not a way into a draft.
   */
  notebook?: string;
  /**
   * `run` only: fixed arguments.
   *
   * Whatever the target also declares and this page has an input for is passed through
   * by name, and these win over that. Matching by name rather than through an expression
   * language is the whole design: both contracts already name their fields, so there is
   * nothing left to invent.
   */
  args?: Record<string, unknown>;
  /** `link` only: where to go. */
  url?: string;
}

/**
 * An action as a page needs it: the declaration, plus what pressing it will ask for.
 *
 * `asks` is derived, never written. A `run` button calls a notebook that already declares
 * its own inputs, so the form for them exists — on that notebook's page. This carries it
 * to the button, so it can be shown in place when pressed rather than living permanently
 * on the calling page, among fields that have nothing to do with what it shows.
 *
 * What the button already fixes through `args` is absent here: it is not a question.
 */
export interface NotebookPageAction extends NotebookAction {
  asks?: NotebookParam[];
}

/**
 * Where one output sits on the page.
 *
 * `i` is an output's *name*, never a widget id — so an output removed from the contract
 * takes its tile with it, and there is no way to have a tile pointing at data that no
 * longer exists. That was the dashboard builder's most common broken state.
 *
 * Only positions live here. Nothing says *what* to draw, because the contract already
 * does. Twelve columns; the height unit is fixed by the renderer.
 */
export interface NotebookLayoutItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface NotebookJson {
  version: string;
  id: string;
  /**
   * Which save of this notebook the copy was read at. **Never stored in the document.**
   *
   * The engine adds it when it hands a notebook out and removes it when one is saved, and a
   * save that carries it is refused if somebody saved since — which is how two editors, or an
   * editor and an agent, stop silently overwriting each other. A client that does not send
   * it is not refused: it overwrites, as every client did before this existed.
   */
  revision?: number;
  name: string;
  runtime: NotebookRuntime;
  /** Secret keys this notebook may read; undeclared means none. */
  secrets?: string[];
  /**
   * Libraries its cells may import. Undeclared means the standard library and nothing else.
   *
   * The same sentence as `secrets`, about a different resource: the notebook names what it
   * needs, and the engine decides whether it may have it. A Python cell may name anything
   * on PyPI, optionally with a version; a JavaScript cell may name one of the few the
   * engine ships, because those load into this process rather than a throwaway environment.
   */
  packages?: string[];
  /**
   * Labels the author puts on this notebook, for finding it again.
   *
   * Twenty-nine notebooks in one flat column is a list you scroll rather than a list you
   * search, and it will be sixty. Tags rather than folders because a notebook that
   * fetches a rate *and* posts a report belongs in both places, and a folder makes you
   * choose. Normalised to lower case, so `Daily` and `daily` are one tag.
   */
  tags?: string[];
  triggers?: NotebookTrigger[];
  /** Values a caller supplies, seeded into scope before the first cell. */
  inputs?: NotebookParam[];
  /**
   * Names lifted from the final scope and handed back to the caller.
   *
   * A bare string is the same as `{ name }` — every document written before outputs
   * could say how they look still reads, and a notebook that never cares keeps saying
   * `outputs: [sum, workings]`.
   */
  outputs?: Array<string | NotebookOutput>;
  /**
   * How the page arranges its outputs, when someone has arranged it.
   *
   * Absent means derived: one full-width tile per output, in declaration order. That is
   * right for most notebooks, which is why it is the default rather than a step everyone
   * has to take.
   *
   * Kept in the document rather than in a table of its own so an agent can write it,
   * deploying pins it with the rest, and there is no arrangement left pointing at a
   * notebook that has moved on.
   */
  layout?: NotebookLayoutItem[];
  /** Buttons on the page. Absent means the page has only its Run button. */
  actions?: NotebookAction[];
  steps: NotebookStep[];
}

/**
 * What production is running for a notebook, and whether the draft has moved on.
 *
 * `hasUndeployedChanges` compares the documents rather than timestamps, so saving
 * without changing anything does not make a notebook look like it needs deploying.
 */
export interface NotebookDeployState {
  isDeployed: boolean;
  deployedAt: string | null;
  deployedBy: string | null;
  hasUndeployedChanges: boolean;
  /**
   * What taking this out of production would switch off.
   *
   * Computed from the deployed document rather than the draft, because that is what is
   * actually serving. Sent with the state so the question "what breaks if I undeploy"
   * is answered before it is asked rather than after.
   */
  serving?: NotebookServing;
}

export interface NotebookServing {
  /** The MCP tool agents currently see, if the contract earned one. */
  toolName: string | null;
  /** Whether it appears under Apps as a page. */
  hasPage: boolean;
  /** Libraries this version installs. Changing them is a production change. */
  packages: string[];
  /** Triggers that would start refusing: cron expressions and webhook slugs. */
  triggers: Array<{ kind: "cron" | "webhook"; label: string }>;
}

/**
 * A deployed notebook, described well enough to render a page for it.
 *
 * There is no layout here and no widgets, because the contract already says everything
 * a page needs: what to ask for, and what to show.
 */
export interface NotebookPage {
  id: string;
  name: string;
  description: string;
  /** The deployed document's tags — what the Apps list filters and groups on. */
  tags: string[];
  /**
   * The notebook's cell notes, and only when it has no contract at all.
   *
   * A notebook that declares nothing and returns nothing is not an app — it is something
   * somebody wrote down. Empty for every page that has outputs, because a page with
   * results should not also carry its author's working notes.
   */
  notes: string[];
  inputs: NotebookParam[];
  /** Always the full form here, whatever the document wrote — the page has to render it. */
  outputs: NotebookOutput[];
  /** Empty when nobody arranged it; the page derives one instead. */
  layout: NotebookLayoutItem[];
  /** Buttons beside Run. Empty is the normal case. */
  actions: NotebookPageAction[];
  /**
   * Whether the person asking also works on this notebook — owns it or was invited to edit
   * it. A page is used by many people and edited by few, and what only the few can do (share
   * a link, open the editor) is not offered to the rest. Absent from an engine that predates
   * it, and from a shared link, where nobody is signed in; read as "do not hide anything".
   */
  canEdit?: boolean;
}

/**
 * A page handed to someone who has no account here.
 *
 * The token never comes back from the server after it is created — it is hashed at rest,
 * so a link that is lost has to be revoked and reissued rather than looked up. That is
 * the same trade as an API key, and for the same reason: a readable credential in a
 * database is a credential everyone with the database has.
 */
export interface NotebookShare {
  id: string;
  notebookId: string;
  hasPassword: boolean;
  createdBy: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  runCount: number;
  /** Returned only in the reply that creates it. */
  token?: string;
}

/**
 * A notebook as it appears in a list, without loading the document.
 *
 * Everything here is something the list itself has to answer: which of these is live,
 * which ran today, which one broke, what is this one for. Before, the answer to *"which
 * of my twenty-nine notebooks is deployed"* was to open all twenty-nine — the list knew
 * nothing but a name and a timestamp, so it could neither sort nor filter on anything a
 * person actually cares about.
 *
 * `snake_case` because these come straight off the row; the two timestamps were already
 * spelled that way and one convention beats a tidier half.
 */
export interface NotebookSummary {
  id: string;
  name: string;
  runtime: NotebookRuntime;
  created_at: string;
  updated_at: string;
  /** True when a version is pinned — that is, when triggers and pages can reach it. */
  deployed: boolean;
  /** When it last ran, by any route. Null when it never has. */
  last_run_at: string | null;
  /** The status of that run, so a list can show a notebook that has been failing. */
  last_run_status: NotebookRunStatus | null;
  /** Distinct kinds of enabled trigger — how this notebook gets started. */
  trigger_kinds: NotebookTriggerKind[];
  tags: string[];
}

/** A person, as the access settings name them. */
export interface AccessUser {
  id: string;
  username: string;
}

/**
 * Who a notebook is shared with, as its owner sees it.
 *
 * `editors` may open, change, deploy and run the notebook. `appVisibility` says who may use
 * the deployed page: `all` is every account, `selected` is `appUsers` plus the owner and the
 * editors. Someone who only uses the page never receives the source and only sees the runs
 * they started.
 */
export interface NotebookAccessSettings {
  owner: AccessUser | null;
  editors: AccessUser[];
  appVisibility: "all" | "selected";
  appUsers: AccessUser[];
}
