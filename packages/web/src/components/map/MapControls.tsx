import { MagnifyingGlass, X } from '@phosphor-icons/react';
import { MAP_ROLE_LABELS, MAP_ROLE_NOTES } from '@zaa-tool/shared';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import type { MapBand } from '../../lib/map-layout';

/**
 * The three things you can do to a map of twenty-nine notebooks, and the key to reading it.
 *
 * Search is here because the map had none — `notebook_about` could answer "where is the
 * one that touches Xendit" for an agent, and a person had to scan a canvas. The standalone
 * toggle states its count for the same reason the notebook list does: a drawing that
 * quietly leaves twenty-nine things out is a drawing you cannot trust for what it shows.
 */

export function MapSearch({
  query,
  onQueryChange,
  matches,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  /** How many notebooks the current query lights up. Only meaningful once typing starts. */
  matches: number;
}) {
  return (
    <div className="relative w-44">
      <MagnifyingGlass
        size={12}
        className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder="Find a notebook"
        aria-label="Find a notebook"
        className="h-6 pl-7 pr-12 text-[11px]"
      />
      {query !== '' && (
        <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
          <span className="text-[9px] text-muted-foreground tabular-nums">{matches}</span>
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => onQueryChange('')}
            className="flex h-4 w-4 items-center justify-center text-muted-foreground hover:text-foreground"
          >
            <X size={10} />
          </button>
        </div>
      )}
    </div>
  );
}

export function StandaloneToggle({
  count,
  showing,
  onChange,
}: {
  count: number;
  showing: boolean;
  onChange: (show: boolean) => void;
}) {
  if (count === 0) return null;

  return (
    <Button
      size="sm"
      variant="ghost"
      aria-pressed={showing}
      className="h-6 shrink-0 px-2 text-[11px] text-muted-foreground"
      onClick={() => onChange(!showing)}
    >
      {showing ? 'Hide the unconnected' : `Show ${count} that stand alone`}
    </Button>
  );
}

/**
 * What the colours mean.
 *
 * Three edge kinds and a deploy mark, none of them explained anywhere before — a reader
 * could see that one arrow was red and had no way to learn it meant a call to a notebook
 * that does not exist. A drawing with an unexplained key is a drawing you guess at.
 *
 * Folded away until asked for. Open, it sat on top of the last row of notebooks, which is
 * the same mistake as a minimap that covers the thing it maps: a key is needed once and an
 * obstruction is permanent.
 */
export function MapLegend() {
  return (
    <details className="group absolute bottom-3 right-3 z-10 border border-border bg-background/95 text-[9px] shadow-sm backdrop-blur">
      <summary className="cursor-pointer list-none px-2.5 py-1 uppercase tracking-widest text-muted-foreground/70 marker:content-none">
        Key
      </summary>
      <ul className="space-y-1 px-2.5 pb-2">
        <li className="flex items-center gap-1.5">
          <span className="h-px w-4 bg-primary" />
          fires it
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-px w-4 bg-muted-foreground" />
          calls it
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-px w-4 bg-status-error" />
          calls something missing
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 bg-status-done" />
          deployed
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 border border-muted-foreground/50" />
          draft only
        </li>
      </ul>
    </details>
  );
}

/**
 * A region's title, drawn in flow coordinates so it scrolls and zooms with the boxes.
 *
 * Outside the canvas it would be a caption that lies the moment you pan. The three names
 * are the shared ones — the same words the agent reads over MCP, which is the whole point
 * of the rule having moved into `shared`.
 */
export function BandTitles({ bands }: { bands: MapBand[] }) {
  return (
    <>
      {bands.map((band) => (
        <div
          key={band.key}
          className="pointer-events-none absolute whitespace-nowrap"
          style={{ left: 0, top: band.y - 26 }}
        >
          <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground/60">
            {band.role ? MAP_ROLE_LABELS[band.role] : 'Stands alone'}
          </span>
          <span className="ml-2 text-[10px] text-muted-foreground/40">
            {band.count} ·{' '}
            {band.role ? MAP_ROLE_NOTES[band.role] : 'nothing calls these and nothing fires them'}
          </span>
        </div>
      ))}
    </>
  );
}
