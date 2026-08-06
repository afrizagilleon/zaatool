/**
 * What the editor actually offers.
 *
 * This file exists because of one sentence in a bug report: *"di editor sama sekali tidak
 * muncul dan tidak ada. saya tidak bisa menguji nya secara manual."* The contract had
 * accepted `type: file` for four milestones. The compiler validated it, the page renderer
 * drew a picker for it, the agent's tool schema exposed it, and the upload endpoint
 * stored the bytes. The dropdown in the editor listed four types, and `file` was not one
 * of them, so the one person who could not create a file input was the person sitting in
 * front of the application.
 *
 * Nothing failed. No test failed either, because every web check was pure logic and pure
 * logic cannot see a dropdown. That is the whole reason this file renders components
 * instead of reading arrays: **a claim about what someone can choose is only settled by
 * looking at what is on the screen.**
 *
 *   pnpm --filter @zaa-tool/web test
 */
import { describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { NotebookParam } from "@zaa-tool/shared";
import { PARAM_TYPES } from "@zaa-tool/shared";
import { ContractPanel } from "../src/components/notebook/ContractPanel";

/** Everything the panel needs, with only the inputs varying between cases. */
function panel(inputs: NotebookParam[], onUpdateInput = vi.fn()) {
  const props = {
    name: "zz-uji-berkas",
    runtime: "node" as const,
    inputs,
    outputs: [] as string[],
    testArgs: {},
    onAddInput: vi.fn(),
    onUpdateInput,
    onRemoveInput: vi.fn(),
    onOutputsChange: vi.fn(),
    onTestArgChange: vi.fn(),
  };
  render(<ContractPanel {...props} />);
  return props;
}

/** The type dropdown for the first input, opened. */
async function openTypeMenu(user: ReturnType<typeof userEvent.setup>) {
  // Radix renders the trigger as a combobox and mounts the options only once open, so
  // there is no way to read the list without performing the click a person performs.
  const trigger = screen.getAllByRole("combobox")[0];
  await user.click(trigger);
  return screen.getByRole("listbox");
}

describe("the type of an input", () => {
  it("offers every type the contract accepts, file included", async () => {
    const user = userEvent.setup();
    panel([{ name: "photo", type: "string" }]);

    const menu = await openTypeMenu(user);
    const offered = within(menu)
      .getAllByRole("option")
      .map((option) => option.textContent?.trim());

    // Compared against the engine's own list rather than a list written here, so a type
    // added to the contract tomorrow fails this test until the editor can choose it.
    expect(offered).toEqual([...PARAM_TYPES]);
    expect(offered).toContain("file");
  });

  it("can be changed to file, which is the click that was impossible", async () => {
    const user = userEvent.setup();
    const onUpdateInput = vi.fn();
    panel([{ name: "photo", type: "string" }], onUpdateInput);

    const menu = await openTypeMenu(user);
    await user.click(within(menu).getByRole("option", { name: "file" }));

    expect(onUpdateInput).toHaveBeenCalledWith(0, { type: "file" });
  });
});

describe("what a file input asks for", () => {
  it("shows an accept box, and only for file", () => {
    panel([{ name: "photo", type: "file" }]);
    expect(screen.getByLabelText(/what photo accepts/i)).toBeTruthy();

    // The other half of "only for file": rendered fresh, so the absence is real and not
    // the first render still hanging around.
    cleanup();
    panel([{ name: "note", type: "string" }]);
    expect(screen.queryByLabelText(/accepts/i)).toBeNull();
  });

  it("writes accept through, so audio/* can be asked for by hand", async () => {
    const user = userEvent.setup();
    const onUpdateInput = vi.fn();
    panel([{ name: "voice", type: "file" }], onUpdateInput);

    // The suggestion chips exist because `audio/*` is the one value with a consequence
    // beyond the picker, and nobody guesses a MIME pattern from an empty box.
    await user.click(screen.getByRole("button", { name: "audio/*" }));
    expect(onUpdateInput).toHaveBeenCalledWith(0, { accept: "audio/*" });
  });

  it("says what audio/* does, because a record button is not implied by the words", () => {
    panel([{ name: "voice", type: "file", accept: "audio/*" }]);
    expect(screen.getByText(/record button/i)).toBeTruthy();
  });

  it("offers no default, since there is nothing anyone could type", () => {
    panel([{ name: "photo", type: "file" }]);
    expect(screen.queryByPlaceholderText(/default/i)).toBeNull();

    cleanup();
    panel([{ name: "note", type: "string" }]);
    expect(screen.getByPlaceholderText(/default/i)).toBeTruthy();
  });

  it("says a test value cannot be typed rather than showing a box that does nothing", () => {
    panel([{ name: "photo", type: "file" }]);
    expect(screen.getByText(/cannot be typed in/i)).toBeTruthy();
  });
});

