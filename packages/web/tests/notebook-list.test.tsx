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
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { NotebookSummary } from "@zaa-tool/shared";
import { NotebookList } from "../src/components/notebook/NotebookList";
import { notebooksApi } from "../src/lib/notebooks-api";

const NOTEBOOKS: NotebookSummary[] = [
  {
    id: "n1",
    name: "daily-exchange-monitor",
    runtime: "node",
    updated_at: "2026-08-06T06:32:44.000Z",
  } as NotebookSummary,
  {
    id: "n2",
    name: "zz-uji-pandas",
    runtime: "python",
    updated_at: "2026-08-06T13:44:14.000Z",
  } as NotebookSummary,
];

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(notebooksApi, "list").mockResolvedValue(NOTEBOOKS);
});

/** Renders and waits for the list to arrive. */
async function list() {
  const onOpen = vi.fn();
  render(<NotebookList onOpen={onOpen} onCreate={vi.fn()} />);
  await screen.findByText("daily-exchange-monitor");
  return { onOpen };
}

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
    expect(row?.textContent).toContain("daily-exchange-monitor");
    expect(within(row as HTMLElement).getByText(/2026/)).toBeTruthy();
  });
});

describe("selecting, which is how deleting starts now", () => {
  it("turns rows into a choice rather than a link", async () => {
    const user = userEvent.setup();
    const { onOpen } = await list();

    await user.click(screen.getByRole("button", { name: "Select" }));
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);

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
    await list();

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
    await list();

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
    await list();

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
