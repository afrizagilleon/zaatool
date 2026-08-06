/**
 * What the app says when it is not on the machine that built it.
 *
 * Three sentences from the report, and one of them is the whole milestone:
 *
 *  - *"tidak bisa membuka di ponsel"* — the bundle named `http://localhost:4000` in
 *    development, and on a phone `localhost` is the phone.
 *  - *"`failed to fetch` bacaannya ketika login"* — the only thing the app ever said
 *    about it, and it names neither an address nor a cause.
 *  - The record button, which cannot work over a LAN address at all, and said "the
 *    microphone was not available" as though the device had none.
 *
 * The first is fixed by configuration and checked in `reachable.test.ts`, on the engine
 * side, where the two proxy lists live. What is checked here is what a person is *told* —
 * because a failure someone can act on and a failure they cannot are different failures,
 * and the difference is entirely in the sentence.
 *
 *   pnpm --filter @zaa-tool/web test
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { NotebookParam } from "@zaa-tool/shared";
import { absoluteUrl, describeRequestFailure } from "../src/lib/api";
import { FileField } from "../src/components/pages/render/FileField";

describe("a request that never arrived", () => {
  it("names the address it tried, instead of `Failed to fetch`", () => {
    const said = describeRequestFailure(new TypeError("Failed to fetch"));

    expect(said).not.toMatch(/^Failed to fetch$/);
    expect(said).toContain(window.location.origin);
    expect(said).toMatch(/could not reach the engine/i);
  });

  it("offers the two things it is actually likely to be", () => {
    // Not a diagnosis — it cannot know. But "not running" and "this device cannot get to
    // it" are the two, and naming them is the difference between a dead end and a next
    // step. On a phone the second one is nearly always the answer.
    const said = describeRequestFailure(new TypeError("Failed to fetch"));
    expect(said).toMatch(/not be running/i);
    expect(said).toMatch(/cannot get to it/i);
  });

  it("keeps the engine's own words when the engine did answer", () => {
    // A refusal that arrived is not a networking problem, and rewriting it as one would
    // hide the reason the engine took the trouble to give.
    const said = describeRequestFailure(new Error("input \"rate\" is required"));
    expect(said).toBe('input "rate" is required');
  });

  it("recognises the other browsers' wording for the same failure", () => {
    // Chrome says "Failed to fetch", Firefox "NetworkError when attempting to fetch
    // resource", Safari "Load failed". Testing only Chrome's is testing one phone.
    for (const wording of ["Failed to fetch", "NetworkError when attempting to fetch resource", "Load failed"]) {
      expect(describeRequestFailure(new TypeError(wording))).toMatch(/could not reach the engine/i);
    }
  });
});

describe("a URL someone is going to paste elsewhere", () => {
  it("is an address, not a path", () => {
    // With one origin the API base is empty, so a webhook URL built by concatenation read
    // `/hooks/abc` — copyable, and useless to the service meant to call it.
    expect(absoluteUrl("/hooks/abc")).toBe(`${window.location.origin}/hooks/abc`);
  });
});

describe("the record button on a phone", () => {
  const voice: NotebookParam = { name: "voice", type: "file", accept: "audio/*" };

  function field() {
    render(<FileField input={voice} value="" onChange={vi.fn()} notebookId="zz-phone" />);
  }

  const realLocation = window.location;

  /** A phone on a LAN address: not a secure context, so no `mediaDevices` at all. */
  function pretendInsecure() {
    Object.defineProperty(window, "isSecureContext", { value: false, configurable: true });
    Object.defineProperty(window, "location", {
      value: { ...realLocation, origin: "http://192.168.1.7:5173" },
      configurable: true,
    });
  }

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, "location", { value: realLocation, configurable: true });
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
  });

  it("says why, and names the address, rather than blaming the device", async () => {
    pretendInsecure();
    const user = userEvent.setup();
    field();

    await user.click(screen.getByRole("button", { name: /record/i }));

    const said = screen.getByText(/secure connection/i).textContent ?? "";
    expect(said).toContain("192.168.1.7");
    // The old sentence. It described a missing microphone, which was never the problem.
    expect(said).not.toMatch(/not available/i);
  });

  it("points at the way round that costs nothing", async () => {
    // A phone's own picker records for `accept="audio/*"`, over plain HTTP, today. Saying
    // "use HTTPS" alone would send someone to install a certificate authority for a file
    // they could have recorded in two taps.
    pretendInsecure();
    const user = userEvent.setup();
    field();

    await user.click(screen.getByRole("button", { name: /record/i }));
    expect(screen.getByText(/secure connection/i).textContent).toMatch(/choose a file/i);
  });

  it("still offers the picker, which works either way", () => {
    pretendInsecure();
    field();
    expect(screen.getByText(/choose a file/i)).toBeTruthy();
  });
});
