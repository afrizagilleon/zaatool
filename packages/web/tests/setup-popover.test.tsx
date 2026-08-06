/**
 * Reachable, not merely present.
 *
 * A component that exists and is never rendered is the same as no component, and this
 * milestone exists because of a gap exactly that shape: `type: file` was in the contract,
 * in the compiler, in the page renderer and in the upload endpoint, and could not be
 * reached from any screen. Building `NotebookPackages` and testing it in isolation would
 * repeat the mistake one level up — a panel nobody can open.
 *
 * So this renders the real toolbar, opens the real Setup popover the way a person does,
 * and asserts the sections are there with their controls inside. It is the check I could
 * not perform in a browser: the preview pane has no session, and entering credentials is
 * not something I do.
 *
 *   pnpm --filter @zaa-tool/web test
 */
import { describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { NotebookRuntime } from "@zaa-tool/shared";
import { NotebookToolbar } from "../src/components/notebook/NotebookToolbar";

function toolbar(overrides: { runtime?: NotebookRuntime; packages?: string[] } = {}) {
  render(
    <NotebookToolbar
      name="zz-uji-pandas"
      runtime={overrides.runtime ?? "python"}
      secrets={[]}
      packages={overrides.packages ?? []}
      isDirty={false}
      isSaving={false}
      isRunning={false}
      staleCount={0}
      triggerCount={0}
      contractShape={{ inputs: 0, outputs: 0 }}
      isPreviewing={false}
      onTogglePreview={vi.fn()}
      allCollapsed={{ note: false, code: false, output: false }}
      onToggleAllSections={vi.fn()}
      onNameChange={vi.fn()}
      onRuntimeChange={vi.fn()}
      onSecretsChange={vi.fn()}
      onPackagesChange={vi.fn()}
      onSave={vi.fn()}
      onRun={vi.fn()}
      onBack={vi.fn()}
    />
  );
}

async function openSetup(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /setup/i }));
}

describe("the Setup popover", () => {
  it("has a Packages section a person can open", async () => {
    const user = userEvent.setup();
    toolbar();
    await openSetup(user);

    expect(screen.getByText("Packages")).toBeTruthy();
    // The control itself, not just the heading — a section with an empty body would
    // pass a heading check and still leave `packages:` unwritable.
    expect(screen.getByLabelText(/add a python requirement/i)).toBeTruthy();
  });

  it("shows the JavaScript allowlist instead when the runtime is node", async () => {
    const user = userEvent.setup();
    toolbar({ runtime: "node" });
    await openSetup(user);

    expect(screen.getByLabelText("yaml")).toBeTruthy();
    expect(screen.queryByLabelText(/add a python requirement/i)).toBeNull();
  });

  it("is reachable from the drawer too, which is the only route on a phone", async () => {
    // The narrow layout hides the Setup popover and offers a drawer instead. Both are in
    // the DOM at once — CSS decides which is visible — so this asserts the drawer really
    // carries the panels rather than a second, emptier copy of the idea.
    const user = userEvent.setup();
    toolbar();

    await user.click(screen.getByRole("button", { name: /everything else/i }));

    const drawer = screen.getByRole("dialog");
    expect(within(drawer).getByText("Packages")).toBeTruthy();
    expect(within(drawer).getByText("Contract")).toBeTruthy();
    expect(within(drawer).getByText("Triggers")).toBeTruthy();
    expect(within(drawer).getByText("Secrets")).toBeTruthy();
  });

  it("counts declared packages on the button, so a closed panel is not a hidden one", async () => {
    const user = userEvent.setup();
    toolbar({ packages: ["pandas", "requests"] });

    // Before opening anything: the count is the only signal that Setup holds something.
    expect(screen.getByRole("button", { name: /setup/i }).textContent).toContain("2");

    await openSetup(user);
    expect(screen.getByText("2 declared")).toBeTruthy();

    cleanup();
    toolbar({ packages: [] });
    await openSetup(userEvent.setup());
    expect(screen.getByText("standard library only")).toBeTruthy();
  });
});
