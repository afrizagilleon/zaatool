import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { useAuthStore } from '../src/store/authStore';

describe('Session expiry handling (T-11)', () => {
  beforeEach(() => {
    localStorage.setItem('zaatool_token', 'expired-mock-token');
    useAuthStore.setState({
      token: 'expired-mock-token',
      user: { id: 'u1', username: 'testuser', email: null, role: 'viewer' },
      error: null,
    });
  });

  afterEach(() => {
    delete (window as unknown as { _originalFetch?: unknown })._originalFetch;
    localStorage.clear();
  });

  it('sessionExpired clears session state and sets session expired error message', () => {
    useAuthStore.getState().sessionExpired();

    const state = useAuthStore.getState();
    expect(state.token).toBeNull();
    expect(state.user).toBeNull();
    expect(state.error).toContain('session has expired');
    expect(localStorage.getItem('zaatool_token')).toBeNull();
  });

  it('fetch interceptor detects 401 response on /api/ request and triggers sessionExpired', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    );

    (window as unknown as { _originalFetch?: typeof fetch })._originalFetch = mockFetch as unknown as typeof fetch;

    const res = await window.fetch('/api/auth/me');
    expect(res.status).toBe(401);

    const state = useAuthStore.getState();
    expect(state.token).toBeNull();
    expect(state.user).toBeNull();
    expect(state.error).toContain('session has expired');
  });
});
