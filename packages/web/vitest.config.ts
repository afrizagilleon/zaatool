import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * The harness that did not exist.
 *
 * Every web check before this one was pure logic — tree helpers, output specs — and the
 * failure that made this milestone necessary was neither. `file` was missing from a
 * dropdown for four milestones; `packages:` had no control at all; a preview rendered an
 * upload field with no notebook to upload to. Not one of those is a logic bug, and not
 * one of them could have been caught by a test that never renders a component.
 *
 * So the rule this encodes is narrow: **a claim about what the editor offers is only
 * proven by rendering the editor.** Reading the source and saying "the array has five
 * entries now" is the same move that produced a manual test list for a screen nobody had
 * opened.
 *
 * Tailwind is deliberately absent — these assert structure and behaviour, never
 * appearance. A test that checks a class name breaks on every restyle and proves nothing
 * about what a person can do.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/**/*.test.tsx"],
    setupFiles: ["./tests/setup.ts"],
  },
});
