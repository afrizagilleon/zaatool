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
  token: string | null;
  user: User | null;
  error: string | null;
  isLoading: boolean;

  login: (username: string, passwordPlain: string) => Promise<boolean>;
  registerUser: (username: string, passwordPlain: string, email?: string) => Promise<boolean>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<boolean>;
  sessionExpired: () => void;
  logout: () => void;
  checkAuth: () => Promise<boolean>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      error: null,
      isLoading: false,

      login: async (username, passwordPlain) => {
        set({ isLoading: true, error: null });
        try {
          const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password: passwordPlain }),
          });

          const data = await res.json().catch(() => null);
          if (!res.ok) {
            throw new Error(data?.error || `Login failed (${res.status})`);
          }

          set({
            token: data.token,
            user: data.user,
            isLoading: false,
          });
          // Store token in localStorage for the fetch interceptor
          localStorage.setItem('zaatool_token', data.token);
          return true;
        } catch (err: unknown) {
          // `Failed to fetch` was the last thing this app said to you on a phone, and it
          // named neither the address nor the reason. It says both now.
          set({ error: describeRequestFailure(err), isLoading: false });
          return false;
        }
      },

      registerUser: async (username, passwordPlain, email) => {
        set({ isLoading: true, error: null });
        try {
          const res = await fetch(`${API_BASE_URL}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password: passwordPlain, email }),
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
            headers: { 'Content-Type': 'application/json' },
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
        set({ token: null, user: null, error: 'Your session has expired. Please log in again.' });
        localStorage.removeItem('zaatool_token');
      },

      logout: () => {
        set({ token: null, user: null, error: null });
        localStorage.removeItem('zaatool_token');
      },

      checkAuth: async () => {
        const token = get().token;
        if (!token) return false;

        try {
          const res = await fetch(`${API_BASE_URL}/api/auth/me`, {
            headers: { 'Authorization': `Bearer ${token}` },
          });

          if (!res.ok) {
            // A `401` means the token itself was refused, and the interceptor below has
            // already ended the session *and* left the sentence explaining why. Calling
            // `logout()` here would wipe that sentence — which is how the most ordinary
            // expiry of all, opening the app the next morning, landed on a login screen
            // that said nothing at all.
            if (res.status !== 401) get().logout();
            return false;
          }

          const data = await res.json().catch(() => null);
          if (!data || !data.user) return false;
          set({ user: data.user });
          return true;
        } catch {
          get().logout();
          return false;
        }
      },


      clearError: () => set({ error: null }),
    }),
    {
      name: 'zaa-auth-storage',
      partialize: (state) => ({ token: state.token, user: state.user }),
    }
  )
);

/**
 * Carries the session on every request to this engine, and notices when it is refused.
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
    const token = localStorage.getItem('zaatool_token');

    if (url.includes('/api/') && token) {
      init = init || {};
      const headers = new Headers(init.headers || {});
      if (!headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${token}`);
      }
      init.headers = headers;
    }

    const res = await baseFetch(input, init);

    // Login is excluded deliberately: a wrong password is also a `401`, and telling
    // somebody their session expired while they are trying to start one is nonsense.
    if (url.includes('/api/') && !url.includes('/api/auth/login') && token && res.status === 401) {
      useAuthStore.getState().sessionExpired();
    }

    return res;
  };
}

if (typeof window !== 'undefined' && window.fetch) {
  window.fetch = withSession(window.fetch.bind(window));
}

