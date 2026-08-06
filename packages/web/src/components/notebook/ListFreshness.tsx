import { WifiSlash, ArrowClockwise } from '@phosphor-icons/react';
import { Button } from '../ui/button';

/**
 * Says when a list has stopped being told things.
 *
 * Invisible while the connection is up, which is almost always — a banner reading
 * "connected" on every screen is furniture, and furniture is what people stop reading
 * before the one time it says something.
 *
 * It exists because of what a dead socket looks like from inside the page: nothing
 * arrives, which is exactly what a quiet workspace looks like. Without this, a list that
 * has silently been an hour stale is indistinguishable from a correct one, and the whole
 * point of updating without a refresh is undone by not knowing when it stopped.
 *
 * The button is here rather than a bare sentence because "your screen may be wrong" with
 * nothing to press is a complaint, not a control.
 */
export function ListFreshness({ live, onRefresh }: { live: boolean; onRefresh: () => void }) {
  if (live) return null;

  return (
    <div
      role="status"
      className="mb-3 flex flex-wrap items-center gap-2 border border-border/60 bg-muted/40 px-2.5 py-1.5 text-[11px] text-muted-foreground"
    >
      <WifiSlash size={13} className="shrink-0" />
      <span>Not live — this list may have moved on since it loaded.</span>
      <Button
        size="sm"
        variant="ghost"
        className="ml-auto h-6 shrink-0 px-2 text-[11px]"
        onClick={onRefresh}
      >
        <ArrowClockwise size={11} className="mr-1.5" />
        Refresh
      </Button>
    </div>
  );
}
