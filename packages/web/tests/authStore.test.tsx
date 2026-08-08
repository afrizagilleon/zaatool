/**
 * FX10 — the login screen used to report the wrong failure.
 *
 * When postgres was down the engine answered with something that was not JSON, and
 * `await res.json()` threw `SyntaxError: JSON.parse: unexpected character at line 1
 * column 1` — which is what the person saw. It is not a lie exactly, but it describes the
 * parser rather than the outage, and it sent him looking at the browser instead of at the
 * database.
 *
 * The rule these tests hold: whatever comes back, `login` resolves `false` and leaves a
 * sentence in `error` that a person could act on. It never throws, and it never says
 * "could not reach the engine" about an engine that answered.
 *
 *   pnpm --filter @zaa-tool/web test authStore
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { useAuthStore } from '../src/store/authStore';

/** The 502 page an nginx in front of a dead engine serves: HTML, and a status. */
function htmlResponse(status: number): typeof fetch {
  return vi.fn().mockResolvedValue(
    new Response('<html><body><h1>502 Bad Gateway</h1></body></html>', {
      status,
      headers: { 'Content-Type': 'text/html' },
    })
  ) as unknown as typeof fetch;
}

/** The rarer one: a 200 that is still not JSON, from a proxy answering in the engine's place. */
function okButNotJson(): typeof fetch {
  return vi.fn().mockResolvedValue(
    new Response('<html>captive portal</html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    })
  ) as unknown as typeof fetch;
}

describe('a reply that is not JSON', () => {
  beforeEach(() => {
    useAuthStore.setState({ token: null, user: null, error: null, isLoading: false });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('fails the login with the status rather than a parser error', async () => {
    vi.stubGlobal('fetch', htmlResponse(502));

    await expect(useAuthStore.getState().login('user', 'pass')).resolves.toBe(false);

    const { error } = useAuthStore.getState();
    expect(error).toContain('502');
    expect(error).not.toMatch(/JSON|parse|unexpected character/i);
  });

  it('does the same for registration', async () => {
    vi.stubGlobal('fetch', htmlResponse(500));

    await expect(useAuthStore.getState().registerUser('user', 'pass')).resolves.toBe(false);
    expect(useAuthStore.getState().error).toContain('500');
    expect(useAuthStore.getState().error).not.toMatch(/JSON|parse/i);
  });

  it('does the same for a password change', async () => {
    vi.stubGlobal('fetch', htmlResponse(500));

    await expect(useAuthStore.getState().changePassword('curr', 'newpass')).resolves.toBe(false);
    expect(useAuthStore.getState().error).toContain('500');
    expect(useAuthStore.getState().error).not.toMatch(/JSON|parse/i);
  });

  it('treats a session check against a broken engine as simply not signed in', async () => {
    useAuthStore.setState({ token: 'a-token-from-a-previous-session' });
    vi.stubGlobal('fetch', htmlResponse(500));

    await expect(useAuthStore.getState().checkAuth()).resolves.toBe(false);
  });

  it('does not blame the network when the engine answered 200 with rubbish', async () => {
    vi.stubGlobal('fetch', okButNotJson());

    await expect(useAuthStore.getState().login('user', 'pass')).resolves.toBe(false);

    const { error, token } = useAuthStore.getState();
    expect(token).toBeNull();
    // The wrong answer here is "Could not reach the engine" — it was reached.
    expect(error).not.toMatch(/could not reach/i);
    expect(error).toMatch(/could not be read/i);
  });

  it('leaves no half-signed-in state behind', async () => {
    vi.stubGlobal('fetch', htmlResponse(502));

    await useAuthStore.getState().login('user', 'pass');

    expect(useAuthStore.getState().token).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().isLoading).toBe(false);
    expect(localStorage.getItem('zaatool_token')).toBeNull();
  });
});
