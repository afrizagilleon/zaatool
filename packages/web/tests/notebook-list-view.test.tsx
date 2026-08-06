/**
 * Finding one notebook among twenty-nine.
 *
 * The milestone's own definition of done is *"you find a notebook without scrolling"*, and
 * that is a claim about rules rather than about pixels: which rows are shown, in what
 * order, on which page. So it is tested here, against the functions themselves, with no
 * component rendered — a check that reads a filter's output cannot be fooled by a filter
 * that renders beautifully and returns the wrong rows.
 *
 * The fixture is deliberately the shape of the real problem: twenty-nine notebooks, of
 * which fifteen are my own `zz-` scaffolding.
 *
 *   pnpm --filter @zaa-tool/web test
 */
import { describe, expect, it } from "vitest";
import type { NotebookSummary } from "@zaa-tool/shared";
import {
  DEFAULT_FILTERS,
  PAGE_SIZE,
  filterNotebooks,
  groupNotebooks,
  hiddenFixtureCount,
  isFiltered,
  matchesQuery,
  paginate,
  sortNotebooks,
  tagCounts,
  whenLabel,
} from "../src/lib/notebook-list-view";

const DAY = 86_400_000;

function notebook(over: Partial<NotebookSummary> & { name: string }): NotebookSummary {
  return {
    id: over.name,
    runtime: "node",
    created_at: new Date(Date.now() - 30 * DAY).toISOString(),
    updated_at: new Date(Date.now() - DAY).toISOString(),
    deployed: false,
    last_run_at: null,
    last_run_status: null,
    trigger_kinds: [],
    tags: [],
    ...over,
  };
}

/** Fourteen real notebooks and fifteen fixtures — the list as it actually stands. */
const WORKSPACE: NotebookSummary[] = [
  notebook({
    name: "daily-exchange-monitor",
    deployed: true,
    trigger_kinds: ["cron"],
    tags: ["finance", "daily"],
    last_run_at: new Date(Date.now() - 3600_000).toISOString(),
    last_run_status: "success",
  }),
  notebook({
    name: "kurs-usd-idr",
    runtime: "python",
    deployed: true,
    trigger_kinds: ["webhook"],
    tags: ["finance"],
    last_run_at: new Date(Date.now() - 2 * DAY).toISOString(),
    last_run_status: "failed",
  }),
  ...Array.from({ length: 12 }, (_, index) =>
    notebook({ name: `report-${index + 1}`, updated_at: new Date(Date.now() - (index + 2) * DAY).toISOString() })
  ),
  ...Array.from({ length: 15 }, (_, index) => notebook({ name: `zz-fixture-${index + 1}` })),
];

const filters = (over: Partial<typeof DEFAULT_FILTERS> = {}) => ({ ...DEFAULT_FILTERS, ...over });

describe("fixtures, which are most of the list", () => {
  it("are hidden by default", () => {
    // 29 in, 14 out. Fifteen of them are mine, and I put them there.
    expect(WORKSPACE).toHaveLength(29);
    expect(filterNotebooks(WORKSPACE, filters())).toHaveLength(14);
  });

  it("are hidden, never removed — asking shows all 29 again", () => {
    expect(filterNotebooks(WORKSPACE, filters({ showFixtures: true }))).toHaveLength(29);
  });

  it("say how many are hidden, so hiding is never silent", () => {
    expect(hiddenFixtureCount(WORKSPACE, false)).toBe(15);
    expect(hiddenFixtureCount(WORKSPACE, true)).toBe(0);
  });
});

describe("search", () => {
  it("matches tags, not only names", () => {
    // The point of F-062: a tag you can read but not search by is decoration.
    const found = filterNotebooks(WORKSPACE, filters({ query: "finance" }));
    expect(found.map((item) => item.name)).toEqual(["daily-exchange-monitor", "kurs-usd-idr"]);
  });

  it("narrows with each term rather than widening", () => {
    expect(matchesQuery(WORKSPACE[1], "finance python")).toBe(true);
    // `daily-exchange-monitor` is finance too, but it is not python.
    expect(matchesQuery(WORKSPACE[0], "finance python")).toBe(false);
  });

  it("still does not reach a fixture unless fixtures are shown", () => {
    expect(filterNotebooks(WORKSPACE, filters({ query: "fixture-3" }))).toHaveLength(0);
    expect(
      filterNotebooks(WORKSPACE, filters({ query: "fixture-3", showFixtures: true }))
    ).toHaveLength(1);
  });
});

describe("filters that answer a question you cannot answer by looking", () => {
  it("deployed only", () => {
    const live = filterNotebooks(WORKSPACE, filters({ deployedOnly: true }));
    expect(live.map((item) => item.name)).toEqual(["daily-exchange-monitor", "kurs-usd-idr"]);
  });

  it("one tag", () => {
    expect(filterNotebooks(WORKSPACE, filters({ tag: "daily" }))).toHaveLength(1);
  });

  it("knows when it is doing nothing, so Clear is only offered when it would do something", () => {
    expect(isFiltered(filters())).toBe(false);
    expect(isFiltered(filters({ tag: "daily" }))).toBe(true);
    expect(isFiltered(filters({ query: "  " }))).toBe(false);
  });
});

describe("order", () => {
  it("by name, numerically — report-2 before report-10", () => {
    const names = sortNotebooks(filterNotebooks(WORKSPACE, filters()), "name").map((n) => n.name);
    expect(names.indexOf("report-2")).toBeLessThan(names.indexOf("report-10"));
  });

  it("by last run, with never-run last rather than first", () => {
    // `null` sorted as 0 would put every notebook that has never run at the top of a
    // list whose whole purpose is showing what ran recently.
    const ordered = sortNotebooks(filterNotebooks(WORKSPACE, filters()), "run");
    expect(ordered[0].name).toBe("daily-exchange-monitor");
    expect(ordered[1].name).toBe("kurs-usd-idr");
    expect(ordered.at(-1)?.last_run_at).toBeNull();
  });

  it("by last edited, newest first", () => {
    const ordered = sortNotebooks(filterNotebooks(WORKSPACE, filters()), "updated");
    expect(ordered[0].name).toBe("daily-exchange-monitor");
  });
});

describe("pages", () => {
  it("cuts 29 into 20 and 9", () => {
    const all = filterNotebooks(WORKSPACE, filters({ showFixtures: true }));
    expect(paginate(all, 1).items).toHaveLength(PAGE_SIZE);
    expect(paginate(all, 2).items).toHaveLength(9);
    expect(paginate(all, 2).pageCount).toBe(2);
  });

  it("clamps rather than stranding you on an empty page", () => {
    // Filtering while on page 2 must not leave a blank screen that looks like no match.
    const narrowed = filterNotebooks(WORKSPACE, filters({ deployedOnly: true }));
    const slice = paginate(narrowed, 9);
    expect(slice.page).toBe(1);
    expect(slice.items).toHaveLength(2);
  });

  it("reports the true total, not the size of the page", () => {
    expect(paginate(filterNotebooks(WORKSPACE, filters({ showFixtures: true })), 1).total).toBe(29);
  });
});

describe("grouping", () => {
  it("splits by how a notebook is started", () => {
    // Alphabetical by heading — "Called by webhook", "On a schedule" — with the group
    // that means "no answer" last however its label happens to sort.
    const groups = groupNotebooks(filterNotebooks(WORKSPACE, filters()), "trigger");
    expect(groups.map((group) => group.key)).toEqual(["webhook", "cron", "manual"]);
    expect(groups.at(-1)?.items).toHaveLength(12);
  });

  it("puts a notebook with two tags in both sections", () => {
    const groups = groupNotebooks(filterNotebooks(WORKSPACE, filters({ tag: null })), "tag");
    const finance = groups.find((group) => group.key === "finance");
    const daily = groups.find((group) => group.key === "daily");
    expect(finance?.items).toHaveLength(2);
    expect(daily?.items).toHaveLength(1);
    // Untagged goes last whatever it is called alphabetically.
    expect(groups.at(-1)?.key).toBe("~untagged");
  });

  it("is one section when nobody asked for groups", () => {
    const groups = groupNotebooks(WORKSPACE, "none");
    expect(groups).toHaveLength(1);
    expect(groups[0].items).toHaveLength(29);
  });
});

describe("the small labels", () => {
  it("counts tags most-used first", () => {
    expect(tagCounts(WORKSPACE)).toEqual([
      { tag: "finance", count: 2 },
      { tag: "daily", count: 1 },
    ]);
  });

  it("says never rather than 1970 for a notebook that has never run", () => {
    expect(whenLabel(null)).toBe("never");
    expect(whenLabel("not a date")).toBe("never");
    expect(whenLabel(new Date(Date.now() - 7200_000).toISOString())).toBe("2h ago");
  });
});
