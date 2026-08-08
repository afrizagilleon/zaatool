import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { useAuthStore } from '../src/store/authStore';

function htmlResponse(status = 502): typeof fetch {
  return vi.fn().mockResolvedValue(
    new Response('<html><body>Bad Gateway 502</body></html>', {
      status,
      headers: { 'Content-Type': 'text/html' },
    })
  ) as unknown as typeof fetch;
}

describe('authStore non-JSON response handling (T-03)', () => {
  beforeEach(() => {
    useAuthStore.setState({
      token: null,
      user: null,
      error: null,
      isLoading: false,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('handles HTML/non-JSON response in login without throwing SyntaxError', async () => {
    vi.stubGlobal('fetch', htmlResponse(502));

    const ok = await useAuthStore.getState().login('user', 'pass');
    expect(ok).toBe(false);
    const error = useAuthStore.getState().error;
    expect(error).not.toBeNull();
    expect(error).toBeDefined();
    expect(error).toContain('502');
  });

  it('handles HTML/non-JSON response in registerUser without throwing SyntaxError', async () => {
    vi.stubGlobal('fetch', htmlResponse(500));

    const ok = await useAuthStore.getState().registerUser('user', 'pass');
    expect(ok).toBe(false);
    const error = useAuthStore.getState().error;
    expect(error).not.toBeNull();
    expect(error).toContain('500');
  });

  it('handles HTML/non-JSON response in changePassword without throwing SyntaxError', async () => {
    vi.stubGlobal('fetch', htmlResponse(500));

    const ok = await useAuthStore.getState().changePassword('curr', 'newpass');
    expect(ok).toBe(false);
    const error = useAuthStore.getState().error;
    expect(error).not.toBeNull();
    expect(error).toContain('500');
  });

  it('handles HTML/non-JSON response in checkAuth without throwing SyntaxError', async () => {
    useAuthStore.setState({ token: 'mock-token' });
    vi.stubGlobal('fetch', htmlResponse(500));

    const ok = await useAuthStore.getState().checkAuth();
    expect(ok).toBe(false);
  });
});
