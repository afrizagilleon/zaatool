/**
 * How tall a tile is, and how tall its contents want to be.
 *
 * Both halves live here so a test can compare them. The bug this exists to prevent is
 * B-9 / F-103: a table tile short enough that its own pagination controls sat below the
 * fold, so you had to scroll inside a tile to reach the control that scrolls the tile.
 * That is two numbers — the tile's height and the table's height — decided in two files
 * that never met.
 */

/** react-grid-layout is told both of these in `PageGrid`; they must be the same numbers. */
export const ROW_HEIGHT = 40;
export const GRID_MARGIN_Y = 12;

/** A tile spanning `h` grid rows also owns the margins between them. */
export function tileOuterHeight(h: number): number {
  return h * ROW_HEIGHT + (h - 1) * GRID_MARGIN_Y;
}

/** Rows per page. The first is the default, and it is the one the tile must fit. */
export const PAGE_SIZES = [10, 25, 50, 100];

/**
 * The pieces of a table tile, in pixels.
 *
 * **These are read off the Tailwind classes in `TableView.tsx`, not measured in a
 * browser.** Each one names the class it came from so the next person can check it
 * against the markup rather than trusting this list. Where a class sets height directly
 * (`h-7`, `h-6`) the number is exact; where it is padding plus a line box (`py-1.5` on
 * `text-xs`) it is arithmetic on Tailwind's own scale, and could be a pixel or two out.
 *
 * That imprecision is why the comparison below is `>=` with real slack rather than an
 * equality: the claim being defended is "the controls are reachable without scrolling
 * inside the tile", not "the tile is exactly this tall".
 */
export const TABLE_METRICS = {
  /** `h-7` on the search input, plus the `space-y-2` gap under it. */
  searchRow: 28 + 8,
  /** `px-2 py-1.5` + `text-[10px]` line box on the header row. */
  headerRow: 28,
  /** `px-2 py-1.5` + `font-mono text-xs` line box, per body row. */
  bodyRow: 29,
  /** `border-b` top and bottom of the table block. */
  tableBorder: 2,
  /** `h-6` pager buttons, plus the `space-y-2` gap above them. */
  pager: 24 + 8,
  /** The tile's own title bar: `px-3 py-1.5` + `text-[10px]` + `border-b`. */
  tileHeader: 33,
  /** The tile's `p-3` content padding and its border. */
  tilePadding: 26,
} as const;

/**
 * How tall a table tile's contents need to be before anything has to scroll.
 *
 * Defaults to the page size the table actually opens on, rather than a hardcoded ten —
 * change `PAGE_SIZES` and this follows, which is the whole point of them sharing a file.
 */
export function estimateTableContentHeight(rows: number = PAGE_SIZES[0]): number {
  const m = TABLE_METRICS;
  return (
    m.searchRow +
    m.headerRow +
    rows * m.bodyRow +
    m.tableBorder +
    m.pager +
    m.tileHeader +
    m.tilePadding
  );
}
