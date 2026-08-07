import { describe, expect, it } from 'vitest';
import { derivedLayout, tileOuterHeight } from '../src/components/pages/render/PageGrid';


/**
 * Calculates the minimum height required to display a 10-row table widget with
 * search bar, table header, 10 rows, pagination controls, and tile framing/padding.
 *
 * Search input: 36px (28px height + 8px gap)
 * Table header: 28px
 * 10 table rows: 290px (29px per row)
 * Table border: 2px
 * Pagination footer: 32px (24px height + 8px gap)
 * Tile header: 33px
 * Tile padding & border: 26px
 * Total content height requirement: ~447px
 */
export function estimateTableTileContentHeight(rowsCount: number = 10): number {
  const searchBarHeight = 36;
  const tableHeaderHeight = 28;
  const rowHeightPx = 29;
  const tableBorder = 2;
  const footerHeight = 32;
  const tileHeader = 33;
  const tilePaddingAndBorder = 26;

  return (
    searchBarHeight +
    tableHeaderHeight +
    rowsCount * rowHeightPx +
    tableBorder +
    footerHeight +
    tileHeader +
    tilePaddingAndBorder
  );
}

describe('Table tile height (T-09)', () => {
  it('ensures derived table tile height is greater than or equal to 10-row table content height', () => {
    const layout = derivedLayout([{ name: 'testTable', render: 'table' }]);
    const tableItem = layout.find((item) => item.i === 'testTable');
    expect(tableItem).toBeDefined();

    const tileH = tableItem!.h;
    const outerHeightPx = tileOuterHeight(tileH);
    const requiredContentHeight = estimateTableTileContentHeight(10);

    // Tile height in px must be >= required content height so pagination does not fall below fold
    expect(outerHeightPx).toBeGreaterThanOrEqual(requiredContentHeight);
  });
});
