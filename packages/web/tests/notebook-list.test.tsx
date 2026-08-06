/**
 * Deleting a notebook has to be something you meant.
 *
 * The report: *"action delete tidak sengaja tertekan di dalam menu notebooks saat di
 * ponsel."* A notebook was deleted by a thumb.
 *
 * Reading the code afterwards, it was worse than an unlucky tap. The bin sat on every row
 * at `opacity-0 group-hover:opacity-100`, and **an invisible element is still a tappable
 * one** — `opacity` changes what you see, not what receives the click. A phone has no
 * hover, so on a phone that button was permanently invisible and permanently live, sitting
 * a few pixels from the row you press to open a notebook. It called `delete` immediately:
 * no confirmation, no undo, and nothing on screen afterwards to say what had gone.
 *
 * So the checks here are about consequence, not layout. The first one is the one that
 * matters: **on the ordinary screen there is no way to delete anything at all.**
 *
 *   pnpm --filter @zaa-tool/web test
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { NotebookSummary } from "@zaa-tool/shared";
import { NotebookList } from "../src/components/notebook/NotebookList";
import { notebooksApi } from "../src/lib/notebooks-api";

/**
 * Written out in full rather than cast with `as NotebookSummary`. The cast is what let
 * this fixture keep compiling while the type grew five fields it did not have — and the
 * component then read `tags.includes(...)` off `undefined` at run time. A fixture that
 * lies to the compiler tests a shape nothing ever sends.
 */
function summary(over: Partial<NotebookSummary> & { id: string; name: string }): NotebookSummary {
  return {
    runtime: "node",
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-08-06T06:32:44.000Z",
    deployed: false,
    last_run_at: null,
    last_run_status: null,
    trigger_kinds: [],
    tags: [],
    ...over,
  };
}

const NOTEBOOKS: NotebookSummary[] = [
  summary({
    id: "n1",
    name: "daily-exchange-monitor",
    deployed: true,
    trigger_kinds: ["cron"],
    tags: ["finance"],
    last_run_at: "2026-08-06T06:00:00.000Z",
    last_run_status: "failed",
  }),
  // A fixture, so it is hidden until asked for — every check below that names it has to
  // show them first, which is itself the proof that the default hides it.
  summary({
    id: "n2",
    name: "zz-uji-pandas",
    runtime: "python",
    updated_at: "2026-08-06T13:44:14.000Z",
  }),
];

beforeEach(() => {
  vi.restoreAllMocks();
  // The fixture toggle is remembered between visits, which means it is also remembered
  // between tests unless it is cleared here.
  window.localStorage.clear();
  vi.spyOn(notebooksApi, "list").mockResolvedValue(NOTEBOOKS);
});

/**
 * Renders and waits for the list to arrive.
 *
 * `withFixtures` presses the button that reveals them, because they are hidden by
 * default now — which means every check below that names `zz-uji-pandas` has to ask for
 * it first, and that is itself the proof the default holds.
 */
async function list({ withFixtures = false } = {}) {
  const onOpen = vi.fn();
  render(<NotebookList onOpen={onOpen} onCreate={vi.fn()} />);
  await screen.findByText("daily-exchange-monitor");
  if (withFixtures) {
    await userEvent.setup().click(screen.getByRole("button", { name: /show 1 test fixture/i }));
  }
  return { onOpen };
}

describe("the fixtures I left in your workspace", () => {
  it("are not in the list until you ask", async () => {
    await list();
    expect(screen.queryByText("zz-uji-pandas")).toBeNull();
    expect(screen.getByRole("button", { name: /show 1 test fixture/i })).toBeTruthy();
  });

  it("says how many it is searching, not how many exist", async () => {
    // The report: *"placeholder berkata Search 33 … tetapi yang muncul hanya 13. zz-*
    // *dihapus semua kah?"* One number above a list of a different length reads as
    // twenty notebooks having gone missing. Both numbers, or neither is honest.
    await list();
    expect(screen.getByLabelText("Search").getAttribute("placeholder")).toBe(
      "Search 1 of 2 by name or tag"
    );
  });

  it("says only one number when nothing is being held back", async () => {
    await list({ withFixtures: true });
    expect(screen.getByLabelText("Search").getAttribute("placeholder")).toBe(
      "Search 2 by name or tag"
    );
  });

  it("remembers that you asked, so the next visit does not ask again", async () => {
    // Hiding is the right default for a workspace two-thirds scaffolding; it is not a
    // verdict. Pressing the same button after every reload is the app forgetting
    // something you already told it.
    await list({ withFixtures: true });
    cleanup();

    render(<NotebookList onOpen={vi.fn()} onCreate={vi.fn()} />);
    expect(await screen.findByText("zz-uji-pandas")).toBeTruthy();
  });

  it("are hidden, not deleted — asking brings it straight back", async () => {
    const remove = vi.spyOn(notebooksApi, "delete");
    await list({ withFixtures: true });

    expect(screen.getByText("zz-uji-pandas")).toBeTruthy();
    expect(remove).not.toHaveBeenCalled();
  });
});

describe("what a row says without being opened", () => {
  it("shows that it is deployed, and that its last run failed", async () => {
    await list();
    const row = screen.getByText("daily-exchange-monitor").closest("div")?.parentElement
      ?.parentElement as HTMLElement;

    // Both were previously answerable only by opening the notebook, which for
    // twenty-nine notebooks is twenty-nine answers nobody ever got.
    expect(within(row).getByLabelText("Deployed")).toBeTruthy();
    expect(within(row).getByLabelText("On a schedule")).toBeTruthy();
    expect(row.textContent).toContain("ran");
    expect(within(row).getByText("#finance")).toBeTruthy();
  });

  it("filters by a tag when the tag is pressed, without opening the notebook", async () => {
    const user = userEvent.setup();
    const { onOpen } = await list();

    await user.click(screen.getByText("#finance"));
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.getByText("daily-exchange-monitor")).toBeTruthy();
  });
});

describe("the ordinary screen", () => {
  it("has no way to delete anything", async () => {
    const remove = vi.spyOn(notebooksApi, "delete");
    await list();

    // Every control on the screen, including the ones nobody can see. `opacity-0` is not
    // absence, and that distinction is the whole bug.
    const labels = screen
      .getAllByRole("button")
      .map((button) => `${button.textContent} ${button.getAttribute("title") ?? ""}`.toLowerCase());

    expect(labels.some((label) => label.includes("delete"))).toBe(false);
    expect(remove).not.toHaveBeenCalled();
  });

  it("opens a notebook when a row is pressed", async () => {
    const user = userEvent.setup();
    const { onOpen } = await list();

    await user.click(screen.getByText("daily-exchange-monitor"));
    expect(onOpen).toHaveBeenCalledWith("n1");
  });

  it("shows the name and the time on separate lines, so neither cuts the other short", async () => {
    // On one line the name was the only thing that could give way — `zz-uji-berka…` while
    // a timestamp nobody reads kept its full width.
    await list();
    const name = screen.getByText("daily-exchange-monitor");
    const row = name.closest("div")?.parentElement;

    expect(name.className).toContain("truncate");
    expect(row?.parentElement?.textContent).toContain("daily-exchange-monitor");
    // Relative on the row and absolute in the tooltip — both, because "3d ago" is what
    // you read at a glance and the exact moment is what you need twice a month.
    const edited = within(row?.parentElement as HTMLElement).getByText(/^edited /);
    expect(edited.getAttribute("title")).toContain("2026");
  });
});

describe("selecting, which is how deleting starts now", () => {
  it("turns rows into a choice rather than a link", async () => {
    const user = userEvent.setup();
    const { onOpen } = await list();

    await user.click(screen.getByRole("button", { name: "Select" }));
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);

    // The same tap that opened a notebook a moment ago now ticks it. A mode that looked
    // different but behaved the same would be worth nothing.
    await user.click(screen.getByText("daily-exchange-monitor"));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("cannot delete nothing", async () => {
    const user = userEvent.setup();
    await list();

    await user.click(screen.getByRole("button", { name: "Select" }));
    expect(screen.getByRole("button", { name: /delete 0/i })).toHaveProperty("disabled", true);
  });

  it("asks first, and names what would go", async () => {
    const user = userEvent.setup();
    const remove = vi.spyOn(notebooksApi, "delete").mockResolvedValue({ success: true });
    await list({ withFixtures: true });

    await user.click(screen.getByRole("button", { name: "Select" }));
    await user.click(screen.getByText("zz-uji-pandas"));
    await user.click(screen.getByRole("button", { name: /delete 1/i }));

    // Still nothing deleted. The dialog is a question, not a progress report.
    expect(remove).not.toHaveBeenCalled();

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/delete 1 notebook\?/i)).toBeTruthy();
    // The number is not enough: names are what tell you whether the third one is the
    // thing you spent yesterday on.
    expect(within(dialog).getByText("zz-uji-pandas")).toBeTruthy();
    expect(within(dialog).getByText(/cannot be undone/i)).toBeTruthy();
  });

  it("deletes only what was ticked, and only after the second press", async () => {
    const user = userEvent.setup();
    const remove = vi.spyOn(notebooksApi, "delete").mockResolvedValue({ success: true });
    await list({ withFixtures: true });

    await user.click(screen.getByRole("button", { name: "Select" }));
    await user.click(screen.getByText("zz-uji-pandas"));
    await user.click(screen.getByRole("button", { name: /delete 1/i }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
    expect(remove).toHaveBeenCalledWith("n2");
  });

  it("cancelling deletes nothing", async () => {
    const user = userEvent.setup();
    const remove = vi.spyOn(notebooksApi, "delete").mockResolvedValue({ success: true });
    await list({ withFixtures: true });

    await user.click(screen.getByRole("button", { name: "Select" }));
    await user.click(screen.getByText("zz-uji-pandas"));
    await user.click(screen.getByRole("button", { name: /delete 1/i }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));

    expect(remove).not.toHaveBeenCalled();
  });

  it("leaving select mode puts the destructive control away again", async () => {
    const user = userEvent.setup();
    await list();

    await user.click(screen.getByRole("button", { name: "Select" }));
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
  });
});
