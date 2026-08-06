/**
 * The one list choice worth remembering between visits.
 *
 * Hiding my test fixtures is the right *default* — a workspace whose list is two thirds
 * scaffolding is unusable, and someone seeing it for the first time should not have to
 * know that. But a default is an opening position, not a verdict: on an account that is
 * for experimenting, the fixtures are the work, and pressing the same button after every
 * reload is the app forgetting something you already told it.
 *
 * So the default hides and the answer sticks. Only this one preference: sort, grouping
 * and search are about the question you are asking right now, and a search term that
 * survived a reload would be a list that mysteriously has three things in it.
 *
 * Per screen, because "show me the fixtures on Apps" and "show me them in Notebooks" are
 * different sentences. Storage is wrapped because `localStorage` throws outright in a
 * private window in some browsers, and a list must not fail to render over a preference.
 */

const PREFIX = 'zaa.list.showFixtures.';

export type ListScreen = 'notebooks' | 'apps';

export function readShowFixtures(screen: ListScreen): boolean {
  try {
    return window.localStorage.getItem(PREFIX + screen) === 'true';
  } catch {
    return false;
  }
}

export function writeShowFixtures(screen: ListScreen, show: boolean): void {
  try {
    window.localStorage.setItem(PREFIX + screen, String(show));
  } catch {
    // A preference that cannot be saved is not an error worth showing anybody.
  }
}
