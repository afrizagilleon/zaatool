import { useState, useCallback } from 'react';
import { API_BASE_URL } from '../lib/api.js';

export interface AgentTokenRecord {
  id: string;
  label: string;
  scope: 'author' | 'reader';
  created_at: string;
  last_used_at: string | null;
}

export function useAgentTokens() {
  const [tokens, setTokens] = useState<AgentTokenRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newlyIssuedToken, setNewlyIssuedToken] = useState<string | null>(null);

  const fetchTokens = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/agent-tokens`);
      const data = await res.json();
      if (res.ok && Array.isArray(data)) {
        setTokens(data);
      } else {
        setError(data.error || 'Failed to fetch agent tokens');
      }
    } catch (e: unknown) {
      setError((e as Error).message || 'Failed to fetch agent tokens');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const issueToken = useCallback(
    async (label: string, scope: 'author' | 'reader' = 'author') => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch(`${API_BASE_URL}/api/agent-tokens`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label, scope }),
        });
        const data = await res.json();
        if (res.ok && data.token) {
          setNewlyIssuedToken(data.token);
          await fetchTokens();
          return data.token as string;
        } else {
          setError(data.error || 'Failed to issue agent token');
          return null;
        }
      } catch (e: unknown) {
        setError((e as Error).message || 'Failed to issue agent token');
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [fetchTokens]
  );

  const revokeToken = useCallback(
    async (id: string) => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch(`${API_BASE_URL}/api/agent-tokens/${id}`, {
          method: 'DELETE',
        });
        const data = await res.json();
        if (res.ok && data.success) {
          await fetchTokens();
          return true;
        } else {
          setError(data.error || 'Failed to revoke agent token');
          return false;
        }
      } catch (e: unknown) {
        setError((e as Error).message || 'Failed to revoke agent token');
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [fetchTokens]
  );

  const clearNewlyIssuedToken = useCallback(() => {
    setNewlyIssuedToken(null);
  }, []);

  return {
    tokens,
    isLoading,
    error,
    newlyIssuedToken,
    clearNewlyIssuedToken,
    fetchTokens,
    issueToken,
    revokeToken,
  };
}
