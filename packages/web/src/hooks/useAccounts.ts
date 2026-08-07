import { useState, useCallback } from 'react';
import { type AccountUser, type Role } from '@zaa-tool/shared';
import { API_BASE_URL } from '../lib/api.js';

export function useAccounts() {
  const [accounts, setAccounts] = useState<AccountUser[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAccounts = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/users`);
      const data = await res.json();
      if (res.ok && data.success) {
        setAccounts(data.users);
      } else {
        setError(data.error || 'Failed to fetch accounts');
      }
    } catch (e: unknown) {
      setError((e as Error).message || 'Failed to fetch accounts');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const createAccount = useCallback(async (form: { username: string; email?: string; passwordPlain: string; role: Role }) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: form.username,
          password: form.passwordPlain,
          email: form.email || undefined,
          role: form.role,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        await fetchAccounts();
        return true;
      } else {
        setError(data.error || 'Failed to create account');
        return false;
      }
    } catch (e: unknown) {
      setError((e as Error).message || 'Failed to create account');
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [fetchAccounts]);

  const setActive = useCallback(async (id: string, active: boolean) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        await fetchAccounts();
        return true;
      } else {
        setError(data.error || 'Failed to update account status');
        return false;
      }
    } catch (e: unknown) {
      setError((e as Error).message || 'Failed to update account status');
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [fetchAccounts]);

  return {
    accounts,
    isLoading,
    error,
    setError,
    fetchAccounts,
    createAccount,
    setActive,
  };
}
