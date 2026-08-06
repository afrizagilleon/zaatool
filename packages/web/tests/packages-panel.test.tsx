/**
 * Declaring a library without an agent.
 *
 * `packages:` shipped in M21 with an engine that installs, a compiler that validates, an
 * allowlist that refuses `pg`, and an MCP tool that writes it — and no control anywhere
 * in the editor. The only ways to declare a library were to ask an agent or to import a
 * `.md` file.
 *
 * The quieter half is worse and was found while building this panel: the editor's store
 * did not carry `packages` at all. `loadNotebook` never read it and `getDocument` never
 * wrote it, so opening a Python notebook that declared `pandas` and pressing Save
 * **deleted the declaration**. Nothing reported it. The next run simply had no pandas.
 * That is the last test in this file, and it is the one that matters most.
 *
 *   pnpm --filter @zaa-tool/web test
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { NotebookJson } from "@zaa-tool/shared";
import { ALLOWED_JS_PACKAGES } from "@zaa-tool/shared";
import { NotebookPackages } from "../src/components/notebook/NotebookPackages";
import { useNotebookStore } from "../src/store/notebookStore";

describe("a javascript notebook", () => {
  it("offers the engine's list and nothing else, because the list is closed", () => {
    render(<NotebookPackages runtime="node" packages={[]} onChange={vi.fn()} />);

    const offered = screen.getAllByRole("checkbox").map((box) => box.getAttribute("id"));
    expect(offered).toEqual(ALLOWED_JS_PACKAGES.map((name) => `notebook-package-${name}`));
  });

  it("declares one when it is ticked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<NotebookPackages runtime="node" packages={[]} onChange={onChange} />);

    await user.click(screen.getByLabelText("yaml"));
    expect(onChange).toHaveBeenCalledWith(["yaml"]);
  });

  it("names a declared package the engine will refuse rather than waiting for the run", () => {
    // How this happens in practice: a Python notebook switched to JavaScript. The
    // requirement stays in the document and stops being answerable, and before this the
    // first news of it was a failed run.
    render(<NotebookPackages runtime="node" packages={["pandas"]} onChange={vi.fn()} />);
    expect(screen.getByText(/not available to javascript cells/i)).toBeTruthy();
    expect(screen.getByText("pandas")).toBeTruthy();
  });
});

describe("a python notebook", () => {
  it("takes any requirement, since PyPI is not a list anyone can ship", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<NotebookPackages runtime="python" packages={[]} onChange={onChange} />);

    await user.type(screen.getByLabelText(/add a python requirement/i), "pandas==2.2.0{Enter}");
    expect(onChange).toHaveBeenCalledWith(["pandas==2.2.0"]);
  });

  it("refuses a shape that is a way of running something else, while it is typed", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<NotebookPackages runtime="python" packages={[]} onChange={onChange} />);

    const field = screen.getByLabelText(/add a python requirement/i);
    await user.type(field, "pandas; rm -rf /");

    expect(screen.getByText(/not a plain requirement/i)).toBeTruthy();
    expect(field.getAttribute("aria-invalid")).toBe("true");
  });
});

describe("the document the editor saves", () => {
  /** A notebook as it arrives from the engine, declaring a library. */
  const withPandas: NotebookJson = {
    version: "1.0",
    id: "zz-uji-pandas-id",
    name: "zz-uji-pandas",
    runtime: "python",
    packages: ["pandas"],
    steps: [{ kind: "cell", id: "c1", note: "", code: "return {'n': 1}" }],
  };

  it("still declares pandas after a round trip through the editor", () => {
    // The regression, stated plainly. Before `packages` was carried in the store this
    // came back without it, and the only symptom was a run that had no pandas.
    useNotebookStore.getState().loadNotebook(withPandas);
    expect(useNotebookStore.getState().getDocument().packages).toEqual(["pandas"]);
  });

  it("leaves the key out entirely when nothing is declared", () => {
    // Absent and empty are the same thing to the engine, and a notebook nobody gave
    // libraries to should not grow a `packages: []` line the first time it is opened.
    useNotebookStore.getState().loadNotebook({ ...withPandas, packages: undefined });
    expect("packages" in useNotebookStore.getState().getDocument()).toBe(false);
  });

  it("carries an edit from the panel into the document", () => {
    useNotebookStore.getState().loadNotebook(withPandas);
    useNotebookStore.getState().setPackages(["pandas", "requests"]);

    expect(useNotebookStore.getState().getDocument().packages).toEqual(["pandas", "requests"]);
    expect(useNotebookStore.getState().isDirty).toBe(true);
  });
});
