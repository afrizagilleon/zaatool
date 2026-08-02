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

<!-- zaa:code -->
\`\`\`js
const months = rows.map((r) => ({
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
const total = months.reduce((sum, m) => sum + m.profit, 0);
const best = months.reduce((a, b) => (b.profit > a.profit ? b : a));

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

  // One template rather than a joined list: tables and fenced blocks need single
  // newlines, and a join that puts a blank line between every element quietly breaks
  // both — which is exactly the kind of thing an agent then copies.
  return `# The notebook format

A notebook is front matter plus cells. Front matter carries \`name\`, \`runtime\`
(\`node\` or \`python\`), \`secrets\`, \`inputs\`, \`outputs\` and \`triggers\`. Cells are
separated by \`<!-- zaa:cell -->\`, with \`<!-- zaa:code -->\` before a fenced block.
Prose with one code block and no markers is read as a single cell.

## Values between cells

Whatever a cell returns is merged into a shared scope and read by later cells as a
plain name. Declared inputs arrive under \`inputs\`: \`inputs.year\` in JavaScript,
\`inputs["year"]\` in Python — never as a bare identifier.

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
| \`image\` | an image | a \`data:\` URI or an image URL |
| \`file\` | a download link | \`{ name, path }\` |
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
them. \`render\` is only needed to overrule the guess, most often to ask for a chart
where rows would otherwise become a table.

### Do not draw pictures out of text

Never return an ASCII bar chart, a box drawn with \`│\`, or a table built from \`|\`
and \`-\`. The page draws real ones from the data. Return the rows.

### Rules that keep the renderers honest

- **Nothing is configured.** Table columns come from the object keys; search, sort and
  paging are always on. A chart's x axis is the first non-numeric column unless you
  name one, its series are every numeric column after it, and its colours come from
  the theme.
- **One row shape per output.** Every object in the array should carry the same keys.
- **A chart wants few columns.** Return a second, narrower array for it rather than
  charting a fifteen-column table.
- **Numbers must be numbers.** \`"1,204"\` is a string and will not plot.

## A complete example

${EXAMPLE.trimEnd()}
`;
}
