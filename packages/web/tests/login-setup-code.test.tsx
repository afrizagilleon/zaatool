/**
 * FX-16 — the sign-up form asks for the server's setup code, and only for the first account.
 *
 *   pnpm --filter @zaa-tool/web test login-setup-code
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Login } from '../src/components/pages/Login';
import { useAuthStore } from '../src/store/authStore';

type Policy = { registrationOpen: boolean; firstUser: boolean; cronTimezone: string };

function stubServer(policy: Policy) {
  const registerBodies: Array<Record<string, unknown>> = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/api/auth/policy')) {
      return new Response(JSON.stringify(policy), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.endsWith('/api/auth/register')) {
      registerBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ success: true }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
  return registerBodies;
}

/** Opens the sign-up dialog and returns queries scoped to it (the sign-in form has a Username and a Password too). */
async function openRegisterForm(user: ReturnType<typeof userEvent.setup>, linkText: RegExp) {
  await user.click(await screen.findByRole('button', { name: linkText }));
  return within(await screen.findByRole('dialog'));
}

describe('the sign-up form and the setup code', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, error: null, isLoading: false, checked: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows a Setup code field when this is the first account', async () => {
    stubServer({ registrationOpen: true, firstUser: true, cronTimezone: 'UTC' });
    const user = userEvent.setup();
    render(<Login />);
    const form = await openRegisterForm(user, /create the first one/i);

    expect(await form.findByLabelText(/setup code/i)).toBeDefined();
    expect(form.getByText(/docker compose logs engine/i)).toBeDefined();
  });

  it('does not show it once an account exists', async () => {
    stubServer({ registrationOpen: true, firstUser: false, cronTimezone: 'UTC' });
    const user = userEvent.setup();
    render(<Login />);
    const form = await openRegisterForm(user, /register user/i);

    expect(await form.findByLabelText(/^username/i)).toBeDefined();
    expect(form.queryByLabelText(/setup code/i)).toBeNull();
  });

  it('sends the code with the first registration, and refuses to send without one', async () => {
    const bodies = stubServer({ registrationOpen: true, firstUser: true, cronTimezone: 'UTC' });
    const user = userEvent.setup();
    render(<Login />);
    const form = await openRegisterForm(user, /create the first one/i);

    await user.type(await form.findByLabelText(/^username/i), 'owner');
    await user.type(form.getByLabelText(/^password/i), 'a-long-enough-password');
    await user.type(form.getByLabelText(/confirm password/i), 'a-long-enough-password');

    await user.click(form.getByRole('button', { name: /^register$/i }));
    expect(bodies).toHaveLength(0);

    await user.type(form.getByLabelText(/setup code/i), '  ABCDE-FGHJK  ');
    await user.click(form.getByRole('button', { name: /^register$/i }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0].setupCode).toBe('ABCDE-FGHJK');
    expect(bodies[0].username).toBe('owner');
  });

  it('sends no code for a later account', async () => {
    const bodies = stubServer({ registrationOpen: true, firstUser: false, cronTimezone: 'UTC' });
    const user = userEvent.setup();
    render(<Login />);
    const form = await openRegisterForm(user, /register user/i);

    await user.type(await form.findByLabelText(/^username/i), 'later');
    await user.type(form.getByLabelText(/^password/i), 'a-long-enough-password');
    await user.type(form.getByLabelText(/confirm password/i), 'a-long-enough-password');
    await user.click(form.getByRole('button', { name: /^register$/i }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0].setupCode).toBeUndefined();
  });
});
