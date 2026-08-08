/**
 * A table tile is tall enough to reach its own pagination (T-09, F-103 / B-9).
 *
 * The complaint was that you had to scroll *inside* a tile to reach the control that
 * pages the tile — which is the same shape of bug as a scrollbar inside a scrollbar.
 *
 * What this test can and cannot do, stated plainly because the first version of it did
 * neither: jsdom has no layout engine, so nothing here measures a rendered box. What it
 * compares is two statements of the same requirement — the height the tile is given, and
 * the height its contents ask for — both read from the source rather than retyped here.
 * The first version of this file declared its own `estimateTableTileContentHeight` with
 * seven magic numbers inside the test, which is two independent guesses that agree today
 * and nothing that would notice when they stop.
 *
 *   pnpm --filter @zaa-tool/web test table-tile-height
 */
import { describe, expect, it } from 'vitest';
import { derivedLayout } from '../src/lib/page-layout';
import {
  PAGE_SIZES,
  TABLE_METRICS,
  estimateTableContentHeight,
  tileOuterHeight,
} from '../src/lib/tile-metrics';

function tableTileHeight(): number {
  const layout = derivedLayout([{ name: 'aTable', render: 'table' }]);
  const tile = layout.find((item) => item.i === 'aTable');
  expect(tile, 'a table output should get a tile').toBeDefined();
  return tileOuterHeight(tile!.h);
}

describe('a table tile', () => {
  it('is tall enough for a full first page and the controls under it', () => {
    // The default page size, not a hardcoded ten: if PAGE_SIZES changes, this follows.
    expect(tableTileHeight()).toBeGreaterThanOrEqual(estimateTableContentHeight());
  });

  it('would not be, if the default page were much larger — so the margin is real, not luck', () => {
    // Guards against the opposite failure: a test that passes because the tile is
    // enormous relative to anything. At 25 rows it should genuinely not fit, which
    // tells us the comparison has teeth.
    expect(tableTileHeight()).toBeLessThan(estimateTableContentHeight(25));
  });

  it('grows with the page size it is asked to hold', () => {
    expect(estimateTableContentHeight(20)).toBeGreaterThan(estimateTableContentHeight(10));
    expect(estimateTableContentHeight(20) - estimateTableContentHeight(10)).toBe(
      10 * TABLE_METRICS.bodyRow
    );
  });

  it('opens on the smallest page size, which is the one it has to fit', () => {
    // If someone reorders PAGE_SIZES, the tile is suddenly sized for the wrong page.
    expect(PAGE_SIZES[0]).toBe(Math.min(...PAGE_SIZES));
  });
});
