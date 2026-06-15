import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { API_BASE_URL } from '../lib/api.js';

interface User {
  id: string;
  username: string;
  email: string | null;
}

interface AuthState {
  token: string | null;
  user: User | null;
  error: string | null;
  isLoading: boolean;

  login: (username: string, passwordPlain: string) => Promise<boolean>;
  registerUser: (username: string, passwordPlain: string, email?: string) => Promise<boolean>;
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

          const data = await res.json();
          if (!res.ok) {
            throw new Error(data.error || 'Login failed');
          }

          set({
            token: data.token,
            user: data.user,
            isLoading: false,
          });
          // Store token in localStorage for the fetch interceptor
          localStorage.setItem('zaatool_token', data.token);
          return true;
        } catch (err: any) {
          set({ error: err.message, isLoading: false });
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

          const data = await res.json();
          if (!res.ok) {
            throw new Error(data.error || 'Registration failed');
          }

          set({ isLoading: false });
          return true;
        } catch (err: any) {
          set({ error: err.message, isLoading: false });
          return false;
        }
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
            get().logout();
            return false;
          }

          const data = await res.json();
          set({ user: data.user });
          return true;
        } catch (err) {
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

// Global Fetch Interceptor to attach JWT token
const originalFetch = window.fetch;
window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : (input instanceof Request ? input.url : '');
  
  if (url.includes('/api/')) {
    const token = localStorage.getItem('zaatool_token');
    if (token) {
      init = init || {};
      const headers = new Headers(init.headers || {});
      if (!headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${token}`);
      }
      init.headers = headers;
    }
  }
  
  return originalFetch(input, init);
};
