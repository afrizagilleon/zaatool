import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

/**
 * What jsdom does not have and Radix insists on.
 *
 * These are not conveniences for the tests — they are the difference between a Radix
 * `Select` opening and throwing. jsdom implements the DOM, not a layout engine, so
 * anything that measures or captures a pointer is simply absent. Each stub below is the
 * smallest thing that lets a real component mount; none of them makes an assertion
 * easier to pass.
 */

if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

if (!globalThis.matchMedia) {
  globalThis.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof matchMedia;
}

// A component left mounted between tests keeps its store subscriptions and its portals,
// and the next test reads the previous one's DOM.
afterEach(cleanup);
