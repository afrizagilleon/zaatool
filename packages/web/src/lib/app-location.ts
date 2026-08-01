/**
 * Where you are in the app, expressed in the URL.
 *
 * The section you are looking at, and the notebook you have open, used to live only in
 * memory: a reload dropped you back on Workflows, and there was no way to link a
 * colleague to a notebook. Both are now in the hash, so the back button, a bookmark and
 * a pasted link all mean something.
 *
 * The hash rather than the path because the app is served as a single static page —
 * a path-based route would 404 on a hard refresh without server rewrites.
 */

/** What the URL calls each section. `deploys` is a legacy id; the URL says dashboard. */
export type LocationTab = 'workflows' | 'map' | 'editor' | 'notebooks' | 'resources' | 'dashboard';

export type UiTab = 'workflows' | 'map' | 'editor' | 'notebooks' | 'resources' | 'deploys';

export interface AppLocation {
  tab: LocationTab;
  /** Only meaningful on the notebooks tab: the notebook being edited. */
  notebookId?: string;
}

const TABS: LocationTab[] = ['workflows', 'map', 'editor', 'notebooks', 'resources', 'dashboard'];

/**
 * The canvas has no navbar tab any more — the Map took its place. It stays reachable by
 * opening a saved workflow, so old flows can still be read until notebooks cover their
 * ground and they are deleted for good.
 */

export const DEFAULT_LOCATION: AppLocation = { tab: 'workflows' };

export function toUiTab(tab: LocationTab): UiTab {
  return tab === 'dashboard' ? 'deploys' : tab;
}

export function fromUiTab(tab: UiTab): LocationTab {
  return tab === 'deploys' ? 'dashboard' : tab;
}

/**
 * Reads `#/notebooks/<id>`. An unrecognised hash falls back to the default rather
 * than throwing — a URL is user input, and a typo should land somewhere sensible.
 */
export function parseLocation(hash: string): AppLocation {
  const segments = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [tab, detail] = segments;

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
