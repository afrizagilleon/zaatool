import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { API_BASE_URL, describeRequestFailure } from '../lib/api.js';

interface User {
  id: string;
  username: string;
  email: string | null;
  role?: string;
}

interface AuthState {
  /** Who is signed in, as last confirmed by the engine. Never a credential. */
  user: User | null;
  error: string | null;
  isLoading: boolean;
  /** False until the first answer from `/api/auth/me`, so the app can avoid flashing the login screen. */
  checked: boolean;

  login: (username: string, passwordPlain: string) => Promise<boolean>;
  /** `setupCode` is the one-time code the server prints to its log; only the first account needs it. */
  registerUser: (username: string, passwordPlain: string, email?: string, setupCode?: string) => Promise<boolean>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<boolean>;
  sessionExpired: () => void;
  /** Signs this browser out. Sessions on other devices stay. */
  logout: () => Promise<void>;
  /** Signs out of every device, this one included. */
  logoutEverywhere: () => Promise<void>;
  checkAuth: () => Promise<boolean>;
  clearError: () => void;
}

/**
 * What every request that changes data must carry, so a page on another site cannot make
 * the browser do it with the session cookie. The engine checks for it; see
 * `csrf.middleware.ts` there.
 */
const REQUEST_HEADER = 'X-Zaatool-Request';

/**
 * The session used to be a token kept here, in `localStorage`, where any script on the page
 * could read it. It is a cookie now — `HttpOnly`, so none can — and this app never sees it.
 * What an older version left behind is deleted rather than ignored: a token that no longer
 * does anything is still a credential sitting in storage until it expires.
 */
function forgetOldToken(): void {
  try {
    localStorage.removeItem('zaatool_token');
    const raw = localStorage.getItem('zaa-auth-storage');
    if (raw) {
      const saved = JSON.parse(raw) as { state?: Record<string, unknown> };
      if (saved.state && 'token' in saved.state) {
        delete saved.state.token;
        localStorage.setItem('zaa-auth-storage', JSON.stringify(saved));
      }
    }
  } catch {
    // Storage that throws holds nothing for us to clean.
  }
}

forgetOldToken();

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      error: null,
      isLoading: false,
      checked: false,

      login: async (username, passwordPlain) => {
        set({ isLoading: true, error: null });
        try {
          const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', [REQUEST_HEADER]: '1' },
            body: JSON.stringify({ username, password: passwordPlain }),
          });

          const data = await res.json().catch(() => null);
          if (!res.ok) {
            throw new Error(data?.error || `Login failed (${res.status})`);
          }
          // A 200 whose body is not JSON is rarer than a 502 that isn't, but it happens —
          // a proxy or a captive portal answering in the engine's place. Without this,
          // `data.user` throws a TypeError, and `describeRequestFailure` reads every
          // TypeError as "could not reach the engine", which is the one thing that did
          // not go wrong here.
          if (!data?.user) {
            throw new Error(`Login failed: the engine's reply could not be read (${res.status}).`);
          }

          // The reply also carries a `token`, for scripts. It is deliberately not kept:
          // the session is the cookie the engine just set.
          set({
            user: data.user,
            isLoading: false,
            checked: true,
          });
          return true;
        } catch (err: unknown) {
          // `Failed to fetch` was the last thing this app said to you on a phone, and it
          // named neither the address nor the reason. It says both now.
          set({ error: describeRequestFailure(err), isLoading: false });
          return false;
        }
      },

      registerUser: async (username, passwordPlain, email, setupCode) => {
        set({ isLoading: true, error: null });
        try {
          const res = await fetch(`${API_BASE_URL}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', [REQUEST_HEADER]: '1' },
            body: JSON.stringify({ username, password: passwordPlain, email, setupCode }),
          });

          const data = await res.json().catch(() => null);
          if (!res.ok) {
            throw new Error(data?.error || `Registration failed (${res.status})`);
          }

          set({ isLoading: false });
          return true;
        } catch (err: unknown) {
          set({ error: describeRequestFailure(err), isLoading: false });
          return false;
        }
      },

      changePassword: async (currentPassword, newPassword) => {
        set({ isLoading: true, error: null });
        try {
          const res = await fetch(`${API_BASE_URL}/api/auth/me/password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', [REQUEST_HEADER]: '1' },
            body: JSON.stringify({ currentPassword, newPassword }),
          });

          const data = await res.json().catch(() => null);
          if (!res.ok) {
            throw new Error(data?.error || `Failed to change password (${res.status})`);
          }

          set({ isLoading: false });
          return true;
        } catch (err: unknown) {
          set({ error: describeRequestFailure(err), isLoading: false });
          return false;
        }
      },

      sessionExpired: () => {
        set({ user: null, error: 'Your session has expired. Please log in again.' });
      },

      logout: async () => {
        // The screen answers first; telling the engine to drop the cookie follows. Waiting
        // on the network before showing a login form would make a dead connection look
        // like a button that does nothing.
        set({ user: null, error: null });
        await endSession('/api/auth/logout');
      },

      logoutEverywhere: async () => {
        set({ user: null, error: null });
        await endSession('/api/auth/logout-all');
      },

      checkAuth: async () => {
        try {
          const res = await fetch(`${API_BASE_URL}/api/auth/me`);

          if (!res.ok) {
            // A `401` means the session was refused, and the interceptor below has
            // already ended it *and*, if somebody was signed in, left the sentence
            // explaining why. Clearing the user here would wipe that sentence — which is
            // how the most ordinary expiry of all, opening the app the next morning,
            // landed on a login screen that said nothing at all.
            if (res.status !== 401) set({ user: null });
            set({ checked: true });
            return false;
          }

          const data = await res.json().catch(() => null);
          if (!data || !data.user) {
            set({ checked: true });
            return false;
          }
          set({ user: data.user, checked: true });
          return true;
        } catch {
          set({ user: null, checked: true });
          return false;
        }
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: 'zaa-auth-storage',
      // Only who the engine last said was signed in — a hint so the app can draw itself
      // before `/api/auth/me` answers. The session itself is not here.
      partialize: (state) => ({ user: state.user }),
      version: 1,
      migrate: (saved) => ({ user: (saved as { user?: User | null } | null)?.user ?? null }),
    }
  )
);

/** Asks the engine to drop the cookie. Best effort: the person is already signed out on screen. */
async function endSession(path: string): Promise<void> {
  try {
    await fetch(`${API_BASE_URL}${path}`, { method: 'POST', headers: { [REQUEST_HEADER]: '1' } });
  } catch {
    // Offline: the cookie outlives the tab until it expires, which is the same as it
    // always did when a browser simply closed.
  }
}

/**
 * Marks every request to this engine as the app's own, and notices when the session is refused.
 *
 * The session itself is a cookie the browser attaches, so there is nothing to add here for
 * that — only `credentials` spelled out, and the header the engine asks for on anything that
 * changes data.
 *
 * Both halves belong here rather than in each caller for the same reason: there is one
 * of these and there are dozens of callers, and a caller that forgets is a request that
 * silently goes out unauthenticated, or a dead session nobody reports.
 *
 * Written as a function over a `fetch` rather than inline over `window.fetch` so a test
 * can hand it one. The previous version read an override off `window` that nothing in
 * the app ever set: production code honouring a global hook that existed only for a
 * test, on the path that attaches the token to everything.
 */
export function withSession(baseFetch: typeof fetch): typeof fetch {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : '';

    if (url.includes('/api/')) {
      init = init || {};
      const headers = new Headers(init.headers || {});
      headers.set(REQUEST_HEADER, '1');
      init.headers = headers;
      init.credentials = 'same-origin';
    }

    const res = await baseFetch(input, init);

    // Login is excluded deliberately: a wrong password is also a `401`, and telling
    // somebody their session expired while they are trying to start one is nonsense.
    if (
      url.includes('/api/') &&
      !url.includes('/api/auth/login') &&
      useAuthStore.getState().user &&
      res.status === 401
    ) {
      useAuthStore.getState().sessionExpired();
    }

    return res;
  };
}

if (typeof window !== 'undefined' && window.fetch) {
  window.fetch = withSession(window.fetch.bind(window));
}

