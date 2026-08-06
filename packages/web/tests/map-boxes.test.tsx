/**
 * FX6.2 — the box a node is laid out as must be the box it draws.
 *
 * His report was two screenshots and *"lihat titik atas dan bawahnya. aneh sekali!"* — the
 * little squares an edge attaches to, floating in space with a gap between them and the
 * cell they belonged to.
 *
 * The cause was mine and it was from the previous milestone. Declaring a node's size does
 * not *hint* at anything: xyflow sets the node's box to exactly that, so a cell declared
 * 76px tall that drew 52 had 24px of invisible box hanging below its border, with the
 * edge's endpoint sitting at the bottom of it. Every arrow left from a point that was not
 * on the shape it came from.
 *
 * The whole suite stayed green through all of it, and still did after the fix: reverting
 * the height to the broken 76 changed nothing, because nothing was watching. jsdom has no
 * layout engine, so no test here can measure a rendered box — what *can* be checked is
 * that the two statements of the same number agree. That is the drift that shipped.
 *
 *   pnpm --filter @zaa-tool/web test map-boxes
 */
import { describe, expect, it } from 'vitest';
import { BOX_CLASS, SIZES } from '../src/lib/map-graph';

describe('the size a node is laid out as', () => {
  it('is the size its component is told to draw', () => {
    for (const kind of Object.keys(SIZES) as (keyof typeof SIZES)[]) {
      expect(BOX_CLASS[kind], `${kind} width`).toContain(`w-[${SIZES[kind].width}px]`);
      expect(BOX_CLASS[kind], `${kind} height`).toContain(`h-[${SIZES[kind].height}px]`);
    }
  });

  it('states both dimensions for every kind, so neither can be left to the content', () => {
    // A box with only a width is a box whose height is whatever the text happened to
    // need, which is exactly the state that put the handle 24px below the border.
    for (const kind of Object.keys(SIZES) as (keyof typeof SIZES)[]) {
      expect(BOX_CLASS[kind]).toMatch(/w-\[\d+px\]/);
      expect(BOX_CLASS[kind]).toMatch(/h-\[\d+px\]/);
    }
  });

  it('has a class for every size and a size for every class', () => {
    expect(Object.keys(BOX_CLASS).sort()).toEqual(Object.keys(SIZES).sort());
  });
});
