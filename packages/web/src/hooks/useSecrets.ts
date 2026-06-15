import { useState, useCallback } from 'react';
import { API_BASE_URL } from '../lib/api.js';

export interface Secret {
  id: string;
  key: string;
  value: string;
  is_secret: boolean;
  created_at: string;
}

export function useSecrets() {
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchSecrets = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/resources/secrets`);
      if (res.ok) {
        setSecrets(await res.json());
      }
    } catch (e) {
      console.warn('Failed to fetch secrets:', e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const saveSecret = useCallback(async (form: { key: string; value: string; is_secret: boolean }) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/resources/secrets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        await fetchSecrets();
        return true;
      }
    } catch (e) {
      console.error('Failed to save secret:', e);
    }
    return false;
  }, [fetchSecrets]);

  const deleteSecret = useCallback(async (id: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/resources/secrets/${id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        await fetchSecrets();
        return true;
      }
    } catch (e) {
      console.error('Failed to delete secret:', e);
    }
    return false;
  }, [fetchSecrets]);

  return {
    secrets,
    isLoading,
    fetchSecrets,
    saveSecret,
    deleteSecret,
  };
}
