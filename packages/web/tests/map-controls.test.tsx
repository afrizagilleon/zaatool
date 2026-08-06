/**
 * FX6 — the map could not be read, and could not be searched.
 *
 * Three of the twelve findings are about a drawing that had no key, no way to find one
 * notebook among twenty-nine, and no admission that it was leaving most of them out. All
 * three have the same shape: the map knew something and did not say it.
 *
 * These render the controls rather than reading their source, for the reason `phone.test`
 * exists: a claim about what a screen offers is only proven by rendering the screen. The
 * canvas itself is not here — xyflow needs a real viewport — and the part of the canvas
 * worth proving is the layout, which is pure and measured in `map-layout.test.tsx`.
 *
 *   pnpm --filter @zaa-tool/web test map-controls
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MAP_ROLE_LABELS } from '@zaa-tool/shared';
import { BandTitles, MapLegend, MapSearch, StandaloneToggle } from '../src/components/map/MapControls';

describe('saying how many it is leaving out', () => {
  it('offers the ones it is not drawing, by number', () => {
    // The same rule as the notebook list: a drawing that quietly withholds twenty-nine
    // things cannot be trusted for the four it shows.
    render(<StandaloneToggle count={29} showing={false} onChange={vi.fn()} />);
    expect(screen.getByRole('button').textContent).toContain('Show 29 that stand alone');
  });

  it('offers to put them away again once they are shown', async () => {
    const onChange = vi.fn();
    render(<StandaloneToggle count={29} showing onChange={onChange} />);

    await userEvent.setup().click(screen.getByRole('button'));
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('says nothing at all when everything is already joined up', () => {
    // A button reading "show 0" is a control for a situation that does not exist.
    const { container } = render(<StandaloneToggle count={0} showing={false} onChange={vi.fn()} />);
    expect(container.textContent).toBe('');
  });
});

describe('finding one notebook among twenty-nine', () => {
  it('says how many the query reaches', async () => {
    const onQueryChange = vi.fn();
    const { rerender } = render(
      <MapSearch query="" onQueryChange={onQueryChange} matches={0} />
    );

    await userEvent.setup().type(screen.getByLabelText('Find a notebook'), 'k');
    expect(onQueryChange).toHaveBeenCalledWith('k');

    rerender(<MapSearch query="kurs" onQueryChange={onQueryChange} matches={2} />);
    expect(screen.getByLabelText('Find a notebook').closest('div')!.textContent).toContain('2');
  });

  it('has nothing to clear until something is typed', () => {
    const { rerender } = render(<MapSearch query="" onQueryChange={vi.fn()} matches={0} />);
    expect(screen.queryByLabelText('Clear search')).toBeNull();

    rerender(<MapSearch query="kurs" onQueryChange={vi.fn()} matches={1} />);
    expect(screen.getByLabelText('Clear search')).toBeTruthy();
  });
});

describe('the key to the drawing', () => {
  it('explains every colour a reader could see, including the red one', () => {
    // A red arrow meant "calls a notebook that does not exist" and said so nowhere.
    render(<MapLegend />);
    for (const meaning of ['fires it', 'calls it', 'calls something missing', 'deployed']) {
      expect(screen.getByText(meaning)).toBeTruthy();
    }
  });

  it('is folded away, because a key is needed once and an obstruction is permanent', () => {
    const { container } = render(<MapLegend />);
    expect(container.querySelector('details')!.open).toBe(false);
  });
});

describe('the three regions', () => {
  it('titles them with the same words the agent reads over MCP', () => {
    // This is the finding I broke the promise on: the grouping was written for the text
    // output and never for the canvas. One rule in `shared`, two renderers, same words —
    // if these ever drift, the map and `notebook_about` describe different systems.
    render(
      <BandTitles
        bands={[
          { key: 'entry', role: 'entry', y: 0, count: 4 },
          { key: 'reused', role: 'reused', y: 200, count: 1 },
          { key: 'alone', role: null, y: 400, count: 29 },
        ]}
      />
    );

    expect(screen.getByText(MAP_ROLE_LABELS.entry)).toBeTruthy();
    expect(screen.getByText(MAP_ROLE_LABELS.reused)).toBeTruthy();
    // Not one of the three roles: "stands alone" is about having no relations, and
    // "Neither" is about how a notebook is reached. Two questions, two titles.
    expect(screen.getByText('Stands alone')).toBeTruthy();
    expect(screen.queryByText(MAP_ROLE_LABELS.idle)).toBeNull();
  });
});
