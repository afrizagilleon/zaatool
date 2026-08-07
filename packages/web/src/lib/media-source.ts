import { API_BASE_URL } from './api';

/**
 * Where the browser should fetch a picture, a video or a sound from.
 *
 * Handles File/Blob instances (via URL.createObjectURL), data URIs, absolute URLs,
 * and signed url descriptors from storage.
 */
export function mediaSource(value: unknown): string | null {
  if (value instanceof File || value instanceof Blob) {
    return URL.createObjectURL(value);
  }
  if (typeof value === 'string' && value.trim() !== '') return value;
  const file = value as { url?: unknown };
  if (file && typeof file.url === 'string') return `${API_BASE_URL}${file.url}`;
  return null;
}
