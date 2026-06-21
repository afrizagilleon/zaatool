import { useState, useCallback, useEffect } from 'react';
import { API_BASE_URL } from '../lib/api.js';

export interface FileEntry {
  id: string;
  name: string;
  path: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
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
      const params = new URLSearchParams();
      if (currentPath.length > 0) params.set('dir', currentPath.join('/'));
      if (searchTerm.trim()) params.set('search', searchTerm.trim());
      const query = params.toString() ? `?${params.toString()}` : '';
      const res = await fetch(`${API_BASE_URL}/api/resources/files${query}`);
      if (res.ok) {
        setFiles(await res.json());
      }
    } catch (e) {
      console.error('Failed to fetch files:', e);
    } finally {
      setIsLoading(false);
    }
  }, [currentPath, searchTerm]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  const uploadFile = useCallback(async (file: File) => {
    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const dirQuery = currentPath.length > 0 ? `?dir=${encodeURIComponent(currentPath.join('/'))}` : '';
      const res = await fetch(`${API_BASE_URL}/api/resources/files${dirQuery}`, {
        method: 'POST',
        body: formData,
      });
      if (res.ok) {
        await fetchFiles();
        return true;
      }
    } catch (err) {
      console.error('Failed to upload file:', err);
    } finally {
      setIsUploading(false);
    }
    return false;
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
    uploadFile,
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
