import { ACTION_KINDS } from "../core/notebook-actions.js";
import { ALLOWED_JS_PACKAGES } from "../core/notebook-packages.js";
import { OUTPUT_RENDERS } from "../core/notebook-outputs.js";
import { PARAM_TYPES } from "../core/notebook-text.js";

/**
 * The notebook format, written for whoever is about to write one.
 *
 * This exists because of a failure worth remembering. `render` shipped, was tested from
 * every side inside the engine, and reached nobody: `notebook_write` did not mention it,
 * no stored notebook used it, and the conventions resource carried only the workspace's
 * own house rules. An agent asked to build a chart did the only thing it could see how
 * to do and drew one out of `█` characters — then said plainly that it could not find
 * the format and did not want to guess. It was right on both counts.
 *
 * So the rule this file enforces: **a capability an agent cannot discover through MCP
 * does not exist.** Tests prove an engine works; they cannot prove anyone was told.
 *
 * Generated from the same constants the parser validates against, so the list of
 * renders and types here cannot drift from the list that is actually accepted.
 */

/** Exported so a test can parse it — documentation that does not parse is a trap. */
export const EXAMPLE = `---
name: monthly-report
runtime: node
inputs:
  - name: year
    type: number
    default: 2026
outputs:
  - name: months
    render: table
  - name: profit
    render: chart
    x: month
  - name: summary
    render: markdown
---

<!-- zaa:cell -->
# Monthly report

Pulls the ledger, then shapes it three ways: one table to read, one chart to
scan, one paragraph to quote.

<!-- zaa:code -->
\`\`\`js
// Real notebooks fetch here. Literal rows keep the example runnable as written.
const rows = [
  { month: 'Jan', revenue: 812_000, cost: 500_000 },
  { month: 'Feb', revenue: 764_000, cost: 470_000 },
  { month: 'Mar', revenue: 903_000, cost: 512_000 },
];
return { rows };
\`\`\`

<!-- zaa:cell -->
Rows of the same shape become the table and the chart. Nothing else is needed —
no column list, no colours, no axis configuration.

Note \`inputs.rows\`: the previous cell's value arrives the same way a declared
input does.

<!-- zaa:code -->
\`\`\`js
const months = inputs.rows.map((r) => ({
  month: r.month,
  revenue: r.revenue,
  cost: r.cost,
  profit: r.revenue - r.cost,
}));

const profit = months.map(({ month, profit }) => ({ month, profit }));

return { months, profit };
\`\`\`

<!-- zaa:cell -->
<!-- zaa:code -->
\`\`\`js
const total = inputs.months.reduce((sum, m) => sum + m.profit, 0);
const best = inputs.months.reduce((a, b) => (b.profit > a.profit ? b : a));

return {
  summary: [
    \`## \${inputs.year}\`,
    \`Total profit **\${total.toLocaleString()}**.\`,
    \`Best month: \${best.month}.\`,
  ].join('\\n\\n'),
};
\`\`\`
`;

export function renderFormatReference(): string {
  const types = PARAM_TYPES.map((type: string) => `\`${type}\``).join(", ");
  const renders = OUTPUT_RENDERS.map((render) => `\`${render}\``).join(", ");
  // Read from the list the runtime enforces, so the reference cannot drift from it.
  const jsPackages = ALLOWED_JS_PACKAGES.map((name) => `\`${name}\``).join(", ");

  // One template rather than a joined list: tables and fenced blocks need single
  // newlines, and a join that puts a blank line between every element quietly breaks
  // both — which is exactly the kind of thing an agent then copies.
  return `# The notebook format

A notebook is front matter plus cells. Front matter carries \`name\`, \`runtime\`
(\`node\` or \`python\`), \`secrets\`, \`inputs\`, \`outputs\` and \`triggers\`. Cells are
separated by \`<!-- zaa:cell -->\`, with \`<!-- zaa:code -->\` before a fenced block.
Prose with one code block and no markers is read as a single cell.

## Values between cells — read this before writing any code

Whatever a cell returns is merged into a shared scope. **Every later cell reads that
scope through \`inputs\`, and only through \`inputs\`.** A bare name is not defined and
the cell will fail with \`x is not defined\`.

The same is true of the notebook's declared inputs: they arrive in the same place.

\`\`\`js
// cell 1
return { rows: [{ v: 1 }, { v: 2 }] };

// cell 2 — inputs.rows, never rows
return { total: inputs.rows.length, year: inputs.year };
\`\`\`

In Python it is subscript notation: \`inputs["rows"]\`, \`inputs["year"]\`.

## One output per cell

**A page reveals each output the moment the cell that produced it finishes.** So a cell
that computes six outputs makes all six appear together, at the speed of the slowest
thing in it — and a page that could have shown its table in half a second instead shows
nothing for twenty.

Split the work. One cell per output is the default; group only what genuinely cannot be
computed apart.

\`\`\`js
// ✗ one cell — the table waits for the chart and the summary
return { table, chart, summary };

// ✓ three cells — the table appears first, then the chart, then the summary
return { table };
\`\`\`

This costs nothing: later cells read earlier values through \`inputs\`, so splitting a
cell never means computing anything twice.

### A name written twice replaces the first one, silently

Scope is one namespace. If an early cell returns \`{ rows }\` and a later cell also
returns \`{ rows }\`, the second wins and the first is gone — and on the page the reader
watches the value change under them.

This is easy to do by accident inside lanes. Give each cell its own output name unless
you *mean* "replace this".

\`\`\`js
// ✗ the branch quietly replaces the full table with a filtered one
return { table_data: highScorers };

// ✓ a different question deserves a different name
return { high_scorers: highScorers };
\`\`\`

### When parallel is worth it — and when it is not

**Do not reach for lanes by default.** Sequential is easier to read, easier to debug, and
what most notebooks should be. Each lane costs a worker or a Python process, and the
group is only as fast as its slowest lane.

Use a parallel group when **both** are true:

1. The work is genuinely independent — neither lane reads what the other writes.
2. Each lane actually waits on something: a network call, a query, a slow API. Two lanes
   of arithmetic finish in the same millisecond either way and only make the notebook
   harder to follow.

Sequential is right when a cell needs the previous cell's value — which is most of the
time. **Ask before restructuring an existing notebook into lanes**: it is a change to how
someone's notebook reads, not just how fast it runs.

Nesting a group inside a lane is allowed and really does run concurrently, but it earns
its complexity rarely. Two levels is almost always one more than the work needs.

### Independent work goes in parallel lanes

Two outputs that do not need each other should be computed at the same time. Lanes are
written with markers, and a lane may itself contain another parallel group — nesting
really does run concurrently.

\`\`\`markdown
<!-- zaa:parallel -->
<!-- zaa:lane label="Revenue chart" -->
<!-- zaa:cell -->
<!-- zaa:code -->
\`\`\`js
return { revenueChart: inputs.rows.map(…) };
\`\`\`
<!-- zaa:lane label="Region chart" -->
<!-- zaa:cell -->
<!-- zaa:code -->
\`\`\`js
return { regionChart: inputs.rows.map(…) };
\`\`\`
<!-- zaa:end -->
\`\`\`

Two rules that follow from how lanes join:

- **Two lanes must not write the same name.** That is a conflict, not a race, and the run
  is refused.
- **The first cell after a group waits for the slowest lane in it** — a 5-second lane
  beside a 20-second one means the next cell starts at 20 seconds. The 5-second lane's
  *output* is on the page long before that; it is only the next cell that waits. So put
  work that needs everything after the group, and nothing else.

## Inputs

Types: ${types}.

| field | meaning |
|---|---|
| \`name\` | how the cell reads it: \`inputs.name\` |
| \`type\` | one of the types above |
| \`required\` | refused before the run starts if absent and undefaulted |
| \`default\` | used when the caller omits it — put it here, never in prose |
| \`description\` | shown on the page and to you |
| \`options\` | the values it accepts: a dropdown on the page, an enum in the tool schema, anything else refused |
| \`multiple\` | with \`options\`, accepts a list of them |
| \`multiline\` | \`string\` only: a box with room to write in, for a note or a reason |
| \`accept\` | \`file\` only: which kinds, in the words a browser uses — \`image/*\`, \`audio/*\`, \`.csv\` |

\`multiline\` is still a \`string\` — it changes the control, not the type. Use it whenever
someone might type a sentence; a one-line field is a promise about length, and it is the
wrong promise for a note. It is refused on a number, a boolean, or anything with
\`options\`, since none of those have a long form.

### A \`file\` input

The value is never the bytes. Somebody attaches a file on the page, or posts one to the
webhook, and the cell receives an object it can read:

\`\`\`yaml
inputs:
  - name: photo
    type: file
    accept: image/*
\`\`\`

\`\`\`js
const text = inputs.photo.readAsText();      // or readAsBase64(), readAsBuffer()
return { size: text.length, kept: inputs.photo };
\`\`\`

In Python the same object answers to \`read_as_text()\`, \`read_as_base64()\`, \`read_as_bytes()\`.

\`accept: audio/*\` does one thing beyond filtering the picker: the page grows a **record**
button. There is no other way to ask for a voice note, and no separate declaration for it.

A webhook that accepts files **must have a \`secretKey\`**, and it is refused without one.
An open hook that runs a notebook costs a few seconds of somebody's CPU; an open hook that
*stores what you send it* is free disk on a stranger's machine.

## Libraries — \`packages\`

A notebook names the libraries its cells import, in front matter, next to \`secrets\`:

\`\`\`yaml
runtime: python
packages: [pandas, "requests>=2.31"]
\`\`\`

\`\`\`python
import pandas as pd
return {"rows": pd.DataFrame(inputs["raw"]).groupby("month").sum().reset_index().to_dict("records")}
\`\`\`

**Python may name anything on PyPI**, with a version if you need one. The environment is
built before the first cell and cached, so the second run costs nothing.

**JavaScript may name only ${jsPackages}.** Node's own built-in modules always work and
need no declaration. Anything else is refused — a JavaScript package is read from the
engine's own \`node_modules\` rather than installed for the notebook, so that list is part of
the engine rather than part of a notebook.

**Undeclared means the standard library only.** Do not write \`import pandas\` and hope; a
missing declaration is a failure at run time, and declaring it is one line.

## Keeping a file — \`files.write\`

A cell can write a file and hand back where it went:

\`\`\`js
const chart = await files.write("chart.png", pngBuffer);   // Buffer, Uint8Array, or base64
return { chart };                                          // shown as a picture
\`\`\`

\`\`\`python
chart = files.write("chart.png", png_bytes)
return {"chart": chart}
\`\`\`

What comes back is \`{ name, path, url, size, mime }\`. You do not have to say
\`render: image\` — the value knows what it is, and \`auto\` shows a picture for an image, a
player for a video or a sound, and a download link for anything else.

**The same name replaces the file.** \`chart.png\` means *the current chart*, not the four
hundredth one. If you want a history, put the date in the name yourself.

## Outputs — how a value is shown

**This is the part most often missed.** An output is a bare name, or a mapping that
also says how it should be displayed on the notebook's page:

\`\`\`yaml
outputs:
  - total                      # a name on its own is fine
  - name: months
    render: table
  - name: profit
    render: chart
    x: month                   # chart only: the column along the bottom
\`\`\`

\`render\` is one of: ${renders}.

| render | what it produces | wants |
|---|---|---|
| \`auto\` | inferred from the value — the default | anything |
| \`table\` | sortable, searchable, paged | an array of objects |
| \`chart\` | picks a form for you | an array of objects |
| \`bar\` | which is bigger | an array of objects |
| \`line\` | how it changed over time | an array of objects |
| \`area\` | how a total filled up | an array of objects |
| \`pie\` | what share of a whole | an array of objects, **6 rows or fewer** |
| \`markdown\` | formatted prose, GFM tables included | a string |
| \`image\` | an image | a \`data:\` URI, an image URL, or what \`files.write\` returned |
| \`video\` | a player | what \`files.write\` returned, or a video URL |
| \`audio\` | a player | what \`files.write\` returned, or an audio URL |
| \`file\` | a download link | what \`files.write\` returned |
| \`json\` | a formatted dump | anything |
| \`text\` | one plain value | a string or number |

### Choosing a chart

The four forms are four different questions, so pick by what the reader must do:

- **\`bar\`** — compare things side by side. The safe default for named categories.
- **\`line\`** — show change over time. Use when the x axis is a date or a period.
- **\`area\`** — same as line, but the filled total is the point.
- **\`pie\`** — show shares of one whole. **Group down to six rows or fewer first**;
  past that it is drawn as bars instead, because nobody can read a twelve-slice pie.
  A pie reads one measure, so return two columns: a name and a number.

\`chart\` on its own means "you choose" — a date-like x axis becomes a line, anything
else becomes bars.

### What \`auto\` decides on its own

An array of objects is a table. A \`data:image/…\` string is an image. A string with
newlines is markdown. Anything else object-shaped is JSON, and a short string or a
number is text. **So a table costs you nothing** — return rows and the page renders
them.

**Overruling \`auto\` badly is worse than not overruling it.** \`auto\` reads the value it
was actually given; a \`render\` you wrote earlier is a guess about a value that did not
exist yet. The way this goes wrong in practice:

\`\`\`yaml
# ✗ the page shows literal ** and \\n, because text means text
- name: summary
  render: text        # …but the cell returns "**USD → IDR**\\n\\n**16.240**"

# ✓ either say what it is
- name: summary
  render: markdown

# ✓ or say nothing and let the value decide — multi-line is always markdown
- summary
\`\`\`

Declare \`render\` when you know something the value does not show: that rows are meant
to be a chart, that a string is a file path. When in doubt, leave it out.

### Do not draw pictures out of text

Never return an ASCII bar chart, a box drawn with \`│\`, or a table built from \`|\`
and \`-\`. The page draws real ones from the data. Return the rows.

### A cell that is a web address becomes a link

In a table, a value starting \`http://\`, \`https://\` or \`mailto:\` is rendered clickable.
Nothing to declare — put the URL in the cell and **name the column after what it does**,
because the column header is the label:

\`\`\`js
return { rows: orders.map((o) => ({
  order: o.id,
  total: o.total,
  invoice: \`https://billing.example.com/i/\${o.id}\`,   // header reads INVOICE
})) };
\`\`\`

Do **not** put markdown in a cell. \`[Verify](https://…)\` renders as those exact
characters — a table cell is a value, not a document. Return the bare URL.

A table cell is only ever a link, never a button: a link is a destination the row already
carries, and a button would be a side effect with arguments, which is a form.

### Rules that keep the renderers honest

- **Nothing is configured.** Table columns come from the object keys; search, sort and
  paging are always on. A chart's x axis is the first non-numeric column unless you
  name one, its series are every numeric column after it, and its colours come from
  the theme.
- **One row shape per output.** Every object in the array should carry the same keys.
- **A chart wants few columns.** Return a second, narrower array for it rather than
  charting a fifteen-column table.
- **Numbers must be numbers.** \`"1,204"\` is a string and will not plot.

## Buttons on the page

A page always has a Run button. \`actions\` adds others, and there are exactly ${ACTION_KINDS.length}
kinds — this vocabulary is not meant to grow:

\`\`\`yaml
actions:
  - label: Check again
    do: rerun                    # runs this notebook again with the form as it stands
  - label: Email the report
    do: run                      # runs a *different* deployed notebook
    notebook: send-report
    args:
      channel: finance           # fixed here; anything else it declares comes from this page's inputs
  - label: Source data
    do: link
    url: https://example.com/ledger
\`\`\`

| field | applies to | meaning |
|---|---|---|
| \`label\` | all | what the button says — required |
| \`do\` | all | ${ACTION_KINDS.map((kind) => `\`${kind}\``).join(", ")} |
| \`notebook\` | \`run\` | the notebook to call, by name or id. It must be deployed |
| \`args\` | \`run\` | fixed arguments, on top of this page's matching input values |
| \`url\` | \`link\` | \`http://\`, \`https://\`, \`/\`, \`#\` or \`mailto:\` |

A \`link\` starting \`#\` or \`/\` is somewhere in this workspace and opens in the same tab —
\`#/apps\` goes to the app list, \`#/notebooks/<id>\` opens the editor. Anything else is out
on the web and opens a new one, so the reader does not lose the page they were reading.

**A \`run\` button asks for what its target needs.** If the notebook it calls declares
inputs the button does not fix in \`args\`, pressing it opens a small form for exactly
those — the same form that notebook's own page renders, from the same declaration.

So do **not** add an input to this notebook just to feed a button. An input belongs to
the notebook that reads it, and a field declared here sits above Run forever, on a page
it has nothing to do with.

\`\`\`yaml
# the archive notebook needs a note. Declaring it HERE is the mistake:
inputs:
  - name: note        # this page never reads it, and it sits above Run forever
    type: string

# declare it on archive-rates instead, where it is read. Then just:
actions:
  - label: Save to archive
    do: run
    notebook: archive-rates
\`\`\`

A field named in both is filled in from this page and stays editable. A button whose
target takes nothing, or whose every field is fixed by \`args\`, runs on one press with no
form at all.

What \`run\` does **not** do: show what the other notebook returned. It reports that it
ran or that it failed, and nothing else. A page displaying two notebooks' values at once
cannot say which value came from where, so the button is a verb, not a query. If the
reader needs to *see* the other notebook, use \`link\` to its page.

\`run\` buttons are removed from a shared link. A link grants one notebook, not a path
through the workspace.

An action that could not work — no label, an unknown \`do\`, a \`run\` with no
\`notebook\` — is refused when the notebook is written, not silently dropped later.

## What you do not have to write back

\`layout\` and \`actions\` are arranged by a person, in the browser. **Leave them out of a
rewrite and the stored ones are kept.** You are not expected to reproduce a twelve-column
grid you cannot see, and a rewrite that forgot it used to delete an afternoon's work
without saying so.

- omit → kept
- \`actions: []\` → every button removed
- write them out → replaced by exactly what you wrote

**Everything else is not like this.** \`inputs\`, \`outputs\`, \`secrets\` and \`triggers\`
belong to whoever writes the text: omit them and they are gone. Write those in full.

## Changing part of a notebook

**A rewrite is for a rewrite.** Almost nothing is a rewrite.

| what you want to change | what to call |
|---|---|
| one cell's code or note | \`notebook_edit_cell\` |
| \`inputs\`, \`outputs\`, \`layout\`, \`triggers\`, \`secrets\`, \`packages\`, \`actions\`, \`name\` | \`notebook_edit_setup\` |
| the whole thing, from nothing | \`notebook_write\` |

### Reading before changing

1. \`notebook_read part: outline\` — one line per cell: its id, what it reads off
   \`inputs\`, what it writes. **No code**, so it costs a fraction of the full text.
2. \`notebook_read part: cell\` with \`cell:\` — that one cell's code, **plus the names in
   scope where it sits** and the names it must keep writing. Read this rather than the
   whole notebook: the code alone would leave you guessing at \`inputs.…\`.
3. \`notebook_read part: setup\` — front matter alone, with the layout drawn as a grid.

\`\`\`
  012345678911   ← 12 columns
  |AAAAAABBBBBB|
  |AAAAAABBBBBB|
  |CCCCCCCCCCCC|

  A = rate   (x0 y0 w6 h2)
  B = trend  (x6 y0 w6 h2)
  C = table  (x0 y2 w12 h1)
\`\`\`

### Changing one cell

\`notebook_edit_cell\` — \`replace\`, \`insert_before\`, \`insert_after\`, \`append\` or
\`delete\`, naming the cell by id **or by its position**. Every other cell is left byte
for byte as it was.

**Send \`code\` as code.** A markdown fence around the whole thing is unwrapped for you,
and nothing else is guessed at: the code has to parse. An edit that does not is refused
with the parser's reason, and **nothing is saved**. The reply shows the first lines as
they were actually stored.

\`dry_run: true\` reports what the edit would do without saving it.

### Changing what a notebook declares

\`notebook_edit_setup(notebook, key, value)\` replaces one key of the front matter and
touches no cell. \`value\` is JSON; a list replaces the whole list, and \`[]\` clears it.

\`\`\`
  key: "layout"   value: [{"i":"rate","x":0,"y":0,"w":6,"h":2}]
  key: "inputs"   value: [{"name":"pair","type":"string","default":"USD_IDR"}]
  key: "actions"  value: []      ← removes every button
\`\`\`

**Moving a tile does not need the code.** Adding an input does not need the code. That is
the whole reason this exists.

### Why it matters more than tokens

Reproducing nineteen cells from memory to change the twentieth is how cells come back
subtly different from what was stored, and it is how \`layout\` and \`actions\` used to
disappear.

\`notebook_edit_cell\` refuses an edit that would leave a later cell reading a name nothing
writes any more. Deleting the cell that produces \`rows\` while a cell below still reads
\`inputs.rows\` is refused here rather than failing halfway through a run at 3am.

### Before asking someone to deploy

\`notebook_diff\` says which cells and which declarations differ between the draft and
what is actually running. Worth reading before "fixing production" — the draft may
already contain half of what you are about to add.

## Finding what already exists

\`system_map\` groups notebooks by how each one is reached:

- **Starts on its own** — a schedule or a webhook sets it off.
- **Called by others** — it exists to be reused. **Look here before writing anything.**
- **Neither** — run by hand, or unfinished.

\`system_map\` with \`about: "invoice"\` narrows it to what mentions that word in a name, a
contract or a trigger. On a workspace with fifty notebooks, reading all of them to find the
two that matter is the habit worth losing.

## A complete example

${EXAMPLE.trimEnd()}
`;
}
