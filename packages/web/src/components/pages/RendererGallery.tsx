import type { NotebookOutput } from '@zaa-tool/shared';
import { OutputView } from './render/OutputView';
import { RENDERS } from '../../lib/notebook-outputs';

/**
 * Every renderer, against the values it will actually meet.
 *
 * This exists because of a bug that shipped: `remark-gfm` was missing, so a markdown
 * table came out as one long paragraph of pipes. It survived verification because the
 * markdown I tested with was a heading and a bold sentence — the two things that render
 * fine without GFM. I checked the path I had authored, not the path an agent takes.
 *
 * So the cases here are deliberately the awkward ones: a markdown table, an empty array,
 * a null, numbers written as strings, rows whose columns disagree, a pie with too many
 * slices. Anything broken should be visible in one scroll, before it reaches a page.
 *
 * Reachable at `#/gallery`. Not in the navbar — it is a workbench, not a feature.
 */

const ROWS = [
  { month: '2026-01', revenue: 812_000, cost: 500_000 },
  { month: '2026-02', revenue: 764_000, cost: 470_000 },
  { month: '2026-03', revenue: 903_000, cost: 512_000 },
  { month: '2026-04', revenue: 655_000, cost: 480_000 },
];

const REGIONS = [
  { region: 'Jakarta', profit: 312_000 },
  { region: 'Surabaya', profit: 119_000 },
  { region: 'Bandung', profit: 87_000 },
];

const MANY_REGIONS = [
  ...REGIONS,
  { region: 'Medan', profit: 106_000 },
  { region: 'Semarang', profit: 26_000 },
  { region: 'Makassar', profit: 42_000 },
  { region: 'Palembang', profit: 81_000 },
  { region: 'Denpasar', profit: 61_000 },
];

const MARKDOWN_TABLE = `## Financial Report Summary

| Metric | Value |
|:--|--:|
| Total Rows | 93 |
| Total Revenue | Rp 14.422.863 |
| Total Profit | Rp 6.615.569 |
| Average Margin | 45.87% |

Best month **Nov**, worst **May**. See the \`byMonth\` output.

- one
- two
`;

const WIDE_ROWS = Array.from({ length: 60 }, (_, index) => ({
  id: index + 1,
  region: ['Jakarta', 'Surabaya', 'Bandung'][index % 3],
  // Numbers written as strings: what an API returns and a notebook forwards unchanged.
  revenue: String(100_000 + index * 1_337),
  note: index % 7 === 0 ? 'flagged' : '',
}));

const RAGGED = [
  { a: 1, b: 2 },
  { a: 3, c: 4 },
  { d: 'only here' },
];

interface Case {
  label: string;
  output: NotebookOutput;
  value: unknown;
  /** What to look for — a case is only useful if its failure is describable. */
  expect: string;
}

const CASES: Case[] = [
  {
    label: 'markdown with a GFM table',
    output: { name: 'summary', render: 'markdown' },
    value: MARKDOWN_TABLE,
    expect: 'A real table with two columns — not a paragraph of pipes.',
  },
  {
    label: 'auto → markdown (multi-line string)',
    output: { name: 'summary' },
    value: MARKDOWN_TABLE,
    expect: 'Same as above without being told.',
  },
  {
    label: 'auto → table (rows)',
    output: { name: 'months' },
    value: ROWS,
    expect: 'A table. Four rows, count shown, no pager.',
  },
  {
    label: 'table, 60 rows',
    output: { name: 'wide', render: 'table' },
    value: WIDE_ROWS,
    expect: '10 per page by default, a size selector, search, sortable headers.',
  },
  {
    label: 'chart (temporal x) → line',
    output: { name: 'byMonth', render: 'chart', x: 'month' },
    value: ROWS,
    expect: 'A line chart, two distinct series, legend in muted ink.',
  },
  {
    label: 'bar',
    output: { name: 'byRegion', render: 'bar' },
    value: REGIONS,
    expect: 'Bars, single series, no legend.',
  },
  {
    label: 'line',
    output: { name: 'byMonth', render: 'line', x: 'month' },
    value: ROWS,
    expect: 'Lines with no dots, hover shows a tooltip.',
  },
  {
    label: 'area',
    output: { name: 'byMonth', render: 'area', x: 'month' },
    value: ROWS,
    expect: 'Stacked translucent areas.',
  },
  {
    label: 'pie, 3 slices',
    output: { name: 'byRegion', render: 'pie' },
    value: REGIONS,
    expect: 'A donut with three slices and a legend.',
  },
  {
    label: 'pie, 8 slices (too many)',
    output: { name: 'byRegion', render: 'pie' },
    value: MANY_REGIONS,
    expect: 'Falls back to bars and says why.',
  },
  {
    label: 'ragged rows',
    output: { name: 'ragged', render: 'table' },
    value: RAGGED,
    expect: 'Union of columns, blanks where a row lacks one. No crash.',
  },
  {
    label: 'image (data URI)',
    output: { name: 'chartPng', render: 'image' },
    value:
      'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMjAiIGhlaWdodD0iNDAiPjxyZWN0IHdpZHRoPSIxMjAiIGhlaWdodD0iNDAiIGZpbGw9IiMyYTc4ZDYiLz48L3N2Zz4=',
    expect: 'A blue rectangle.',
  },
  {
    label: 'file',
    output: { name: 'report', render: 'file' },
    value: { name: 'report.pdf', path: 'uploads/report.pdf', mime: 'application/pdf' },
    expect: 'A download link reading report.pdf.',
  },
  {
    label: 'text',
    output: { name: 'total' },
    value: 6_615_569,
    expect: 'The number, plainly.',
  },
  {
    label: 'json (object)',
    output: { name: 'meta' },
    value: { source: 'ledger', fetchedAt: '2026-08-02T04:00:00Z', ok: true },
    expect: 'Formatted JSON.',
  },
  {
    label: 'empty array',
    output: { name: 'rows', render: 'table' },
    value: [],
    expect: 'Says there are no rows. Does not crash or show an empty grid.',
  },
  {
    label: 'null',
    output: { name: 'missing' },
    value: null,
    expect: '“nothing”, in italics.',
  },
  {
    label: 'chart on a non-array',
    output: { name: 'total', render: 'chart' },
    value: 42,
    expect: 'Shows 42 as JSON rather than failing — a declaration it cannot honour.',
  },
];

export function RendererGallery() {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-6 px-6 py-8">
        <div>
          <h1 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Renderer gallery
          </h1>
          <p className="mt-2 text-xs text-muted-foreground">
            Every render in <code className="font-mono">{RENDERS.join(', ')}</code>, against
            values a notebook actually produces. If something here looks wrong, it is wrong
            on someone's page too.
          </p>
        </div>

        {CASES.map((entry, index) => (
          <div key={index} className="space-y-2 border border-border p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-xs font-bold">{entry.label}</span>
              <code className="font-mono text-[10px] text-muted-foreground">
                render: {entry.output.render ?? 'auto'}
              </code>
            </div>
            <p className="text-[11px] text-muted-foreground/70">Expect: {entry.expect}</p>
            <div className="border-t border-border pt-3">
              <OutputView output={entry.output} value={entry.value} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
