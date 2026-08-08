import { useState, useCallback, useEffect } from 'react';
import { API_BASE_URL } from '../lib/api.js';

export interface FileEntry {
  id: string;
  name: string;
  path: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  /**
   * Signed and time-limited, minted by the engine with the listing.
   *
   * Absent for folders, and absent from anything older than this listing — which is why
   * nothing here builds a storage URL by hand any more. `/storage` no longer serves a
   * path just because it exists.
   */
  url?: string;
}

/**
 * The one place that says how a listing is asked for.
 *
 * `search` is the engine's name for it (`storage.controller.ts` reads `req.query.search`),
 * and trimming happens here so a box holding only spaces is not a search.
 */
async function listFiles(path: string[], searchTerm: string): Promise<FileEntry[]> {
  const params = new URLSearchParams();
  if (path.length > 0) params.set('dir', path.join('/'));
  if (searchTerm.trim()) params.set('search', searchTerm.trim());
  const query = params.toString() ? `?${params.toString()}` : '';

  const res = await fetch(`${API_BASE_URL}/api/resources/files${query}`);
  if (!res.ok) throw new Error(`Listing failed (${res.status})`);
  return (await res.json()) as FileEntry[];
}

export function useStorage() {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [currentPath, setCurrentPath] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const fetchFiles = useCallback(async () => {
    setIsLoading(true);
    try {
      setFiles(await listFiles(currentPath, searchTerm));
    } catch (e) {
      console.error('Failed to fetch files:', e);
    } finally {
      setIsLoading(false);
    }
  }, [currentPath, searchTerm]);

  // The listing follows the folder and the search box. `cancelled` rather than a bare
  // call to `fetchFiles`: typing produces a request per keystroke, they come back out of
  // order, and without this the results of a prefix can land after the results of the
  // whole word. It also settles `react-hooks/set-state-in-effect`, which objects to the
  // synchronous `setIsLoading(true)` at the top of `fetchFiles`.
  //
  // Both paths call `listFiles`. They were briefly two hand-written copies of the same
  // request, and the copies disagreed within one commit — one sent `search`, the other
  // `q`, and since the engine reads `search`, the search box quietly stopped filtering.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const listing = await listFiles(currentPath, searchTerm);
        if (!cancelled) setFiles(listing);
      } catch (e) {
        console.error('Failed to fetch files:', e);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentPath, searchTerm]);

  const uploadFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return false;
    setIsUploading(true);
    let success: boolean;
    try {
      const dirQuery = currentPath.length > 0 ? `?dir=${encodeURIComponent(currentPath.join('/'))}` : '';
      const uploadPromises = files.map(async (file) => {
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch(`${API_BASE_URL}/api/resources/files${dirQuery}`, {
          method: 'POST',
          body: formData,
        });
        return res.ok;
      });
      const results = await Promise.all(uploadPromises);
      success = results.every(r => r);
      await fetchFiles();
    } catch (err) {
      console.error('Failed to upload files:', err);
      success = false;
    } finally {
      setIsUploading(false);
    }
    return success;
  }, [currentPath, fetchFiles]);

  const createFolder = useCallback(async (name: string) => {
    if (!name.trim()) return false;
    try {
      const dirParam = currentPath.length > 0 ? currentPath.join('/') : '';
      const res = await fetch(`${API_BASE_URL}/api/resources/folders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), dir: dirParam }),
      });
      if (res.ok) {
        await fetchFiles();
        return true;
      }
    } catch (err) {
      console.error('Failed to create folder:', err);
    }
    return false;
  }, [currentPath, fetchFiles]);

  const renameItem = useCallback(async (id: string, newName: string) => {
    if (!newName.trim()) return false;
    try {
      const res = await fetch(`${API_BASE_URL}/api/resources/files/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (res.ok) {
        await fetchFiles();
        return true;
      }
    } catch (err) {
      console.error('Failed to rename item:', err);
    }
    return false;
  }, [fetchFiles]);

  const deleteItem = useCallback(async (id: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/resources/files/${id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        await fetchFiles();
        return true;
      }
    } catch (e) {
      console.error('Failed to delete item:', e);
    }
    return false;
  }, [fetchFiles]);

  const navigateToFolder = useCallback((folderName: string) => {
    setSearchTerm('');
    setCurrentPath((prev) => [...prev, folderName]);
  }, []);

  const navigateUp = useCallback(() => {
    setCurrentPath((prev) => prev.slice(0, -1));
  }, []);

  const navigateToIndex = useCallback((index: number) => {
    setCurrentPath((prev) => prev.slice(0, index + 1));
  }, []);

  const navigateToRoot = useCallback(() => {
    setCurrentPath([]);
  }, []);

  const navigateToPath = useCallback((segments: string[]) => {
    setSearchTerm('');
    setCurrentPath(segments);
  }, []);

  return {
    files,
    currentPath,
    searchTerm,
    setSearchTerm,
    isUploading,
    isLoading,
    fetchFiles,
    uploadFiles,
    createFolder,
    renameItem,
    deleteItem,
    navigateToFolder,
    navigateUp,
    navigateToIndex,
    navigateToRoot,
    navigateToPath,
  };
}
