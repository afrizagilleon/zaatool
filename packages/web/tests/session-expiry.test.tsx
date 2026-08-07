/**
 * A session that ends says so (T-11, RQ-08).
 *
 * The first version of this file tested the interceptor by planting a `fetch` on
 * `window` that the production code read back — so the app shipped a global override
 * hook whose only caller was this file. It now hands `withSession` a `fetch` directly,
 * which is the same thing without the backdoor.
 *
 * The third case is the one that was missing, and it is the one that matters most: a
 * token lives 24 hours, so the ordinary way to meet an expired one is to open the app
 * the next morning. `checkAuth()` runs, the engine refuses the token, and until this
 * test existed the sentence explaining that was set by the interceptor and then wiped
 * by `logout()` one line later. Green suite, blank login screen.
 *
 *   pnpm --filter @zaa-tool/web test session-expiry
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { useAuthStore, withSession } from '../src/store/authStore';

function refuses(status: number): typeof fetch {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ error: 'Unauthorized' }), { status })
  ) as unknown as typeof fetch;
}

describe('a session that ends', () => {
  beforeEach(() => {
    localStorage.setItem('zaatool_token', 'expired-mock-token');
    useAuthStore.setState({
      token: 'expired-mock-token',
      user: { id: 'u1', username: 'testuser', email: null, role: 'viewer' },
      error: null,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('clears the session and leaves a sentence behind', () => {
    useAuthStore.getState().sessionExpired();

    const state = useAuthStore.getState();
    expect(state.token).toBeNull();
    expect(state.user).toBeNull();
    expect(state.error).toContain('session has expired');
    expect(localStorage.getItem('zaatool_token')).toBeNull();
  });

  it('is noticed by the interceptor when the engine answers 401', async () => {
    const res = await withSession(refuses(401))('/api/auth/me');

    expect(res.status).toBe(401);
    const state = useAuthStore.getState();
    expect(state.token).toBeNull();
    expect(state.user).toBeNull();
    expect(state.error).toContain('session has expired');
  });

  it('still says so after checkAuth on a dead token, which is how you meet it', async () => {
    // Exactly what App.tsx does on mount, against the real interceptor.
    vi.stubGlobal('fetch', withSession(refuses(401)));

    const ok = await useAuthStore.getState().checkAuth();

    expect(ok).toBe(false);
    expect(useAuthStore.getState().token).toBeNull();
    expect(useAuthStore.getState().error).toContain('session has expired');
  });

  it('does not claim a session expired when the password was simply wrong', async () => {
    const res = await withSession(refuses(401))('/api/auth/login');

    expect(res.status).toBe(401);
    // Still signed in as far as the store is concerned: nothing expired.
    expect(useAuthStore.getState().error).toBeNull();
  });
});
