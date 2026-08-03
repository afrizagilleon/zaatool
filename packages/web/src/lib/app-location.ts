/**
 * Where you are in the app, expressed in the URL.
 *
 * The section you are looking at, and the notebook you have open, used to live only in
 * memory: a reload dropped you back on the first tab, and there was no way to link a
 * colleague to a notebook. Both are now in the hash, so the back button, a bookmark and
 * a pasted link all mean something.
 *
 * The hash rather than the path because the app is served as a single static page —
 * a path-based route would 404 on a hard refresh without server rewrites.
 */

export type LocationTab = 'apps' | 'map' | 'notebooks' | 'resources' | 'gallery';

export interface AppLocation {
  tab: LocationTab;
  /** Only meaningful on the notebooks tab: the notebook being edited. */
  notebookId?: string;
}

/**
 * `gallery` is deliberately absent from the navbar: it is a workbench for checking
 * every renderer against awkward values, reachable only by typing `#/gallery`.
 */
const TABS: LocationTab[] = ['apps', 'map', 'notebooks', 'resources', 'gallery'];

/**
 * Hashes that used to mean something, kept working.
 *
 * `dashboard` was what the URL called Apps while the tab was still internally named
 * `deploys`; `workflows` and `editor` were the canvas, which is gone. All three land on
 * Apps rather than on an error, because a stale bookmark is not a mistake worth
 * punishing — see `parseLocation`.
 */
const RETIRED: Record<string, LocationTab> = {
  dashboard: 'apps',
  workflows: 'apps',
  editor: 'apps',
};

export const DEFAULT_LOCATION: AppLocation = { tab: 'apps' };

/**
 * Reads `#/notebooks/<id>`. An unrecognised hash falls back to the default rather
 * than throwing — a URL is user input, and a typo should land somewhere sensible.
 */
export function parseLocation(hash: string): AppLocation {
  const segments = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [tab, detail] = segments;

  if (tab && RETIRED[tab]) return { tab: RETIRED[tab] };
  if (!TABS.includes(tab as LocationTab)) return DEFAULT_LOCATION;
  if (tab === 'notebooks' && detail) return { tab: 'notebooks', notebookId: detail };
  return { tab: tab as LocationTab };
}

export function formatLocation(location: AppLocation): string {
  return location.tab === 'notebooks' && location.notebookId
    ? `#/notebooks/${location.notebookId}`
    : `#/${location.tab}`;
}

export function isSameLocation(a: AppLocation, b: AppLocation): boolean {
  return a.tab === b.tab && a.notebookId === b.notebookId;
}
