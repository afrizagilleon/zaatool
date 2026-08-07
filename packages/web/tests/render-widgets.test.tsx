import { describe, expect, it, vi } from 'vitest';
import { mediaSource } from '../src/lib/media-source';

describe('mediaSource (T-00)', () => {
  it('returns blob URL for File or Blob instance', () => {
    const file = new File(['test audio'], 'test.mp3', { type: 'audio/mp3' });
    const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:http://localhost/test-uuid');

    const src = mediaSource(file);
    expect(src).toBe('blob:http://localhost/test-uuid');
    expect(createObjectURLSpy).toHaveBeenCalledWith(file);

    createObjectURLSpy.mockRestore();
  });

  it('returns string URL as-is', () => {
    expect(mediaSource('https://example.com/audio.mp3')).toBe('https://example.com/audio.mp3');
  });

  it('formats object url descriptor with API_BASE_URL', () => {
    expect(mediaSource({ url: '/storage/audio.mp3' })).toContain('/storage/audio.mp3');
  });
});
