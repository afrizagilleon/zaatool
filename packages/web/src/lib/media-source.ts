import { API_BASE_URL } from './api';

/**
 * Where the browser should fetch a picture, a video or a sound from.
 *
 * A string is used as written — a data URI, or a URL somewhere else. A descriptor from
 * `files.write` carries a signed `url`, which is the only way a file on this machine is
 * readable at all. Anything else is not media, and is shown as what it is.
 *
 * A `File` or `Blob` is something the person has only just chosen or recorded and has
 * not uploaded yet: it becomes an object URL so the preview can appear immediately,
 * without waiting for a round trip that has not been asked for.
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
