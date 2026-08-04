import { useCallback, useState } from 'react';
import type { NotebookFile } from '@zaa-tool/shared';
import { API_BASE_URL } from '../lib/api.js';

/**
 * Puts a file where a run can reach it, and hands back what the contract wants.
 *
 * Two steps rather than one, on purpose. A run takes named arguments; if a file could
 * ride along inside the request that starts one, there would be two ways to supply an
 * argument and two things to keep in step. So the file becomes an ordinary value first,
 * and the run that follows is the run any other caller starts.
 *
 * `shareToken` is what a page opened by someone with no account passes: the link is the
 * credential there, exactly as it is for reading the page and running it.
 */
export function useFileUpload(notebookId: string, shareToken?: string) {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = useCallback(
    async (file: File): Promise<NotebookFile | null> => {
      setIsUploading(true);
      setError(null);
      try {
        const body = new FormData();
        body.append('file', file);

        const url = shareToken
          ? `${API_BASE_URL}/api/shared/${shareToken}/uploads`
          : `${API_BASE_URL}/api/notebooks/${notebookId}/uploads`;

        const res = await fetch(url, { method: 'POST', body });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'The upload was refused.');
        return data as NotebookFile;
      } catch (err) {
        setError((err as Error).message);
        return null;
      } finally {
        setIsUploading(false);
      }
    },
    [notebookId, shareToken]
  );

  return { upload, isUploading, error };
}
