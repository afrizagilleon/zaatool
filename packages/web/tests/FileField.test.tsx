import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { FileField } from '../src/components/pages/render/FileField';

describe('FileField video preview & re-record (T-01)', () => {
  it('renders video player for chosen video file', () => {
    const fileVal = JSON.stringify({
      name: 'clip.mp4',
      path: 'storage/clip.mp4',
      url: '/storage/clip.mp4',
      size: 4096,
      mime: 'video/mp4',
    });

    const { container } = render(
      <FileField
        input={{ name: 'video_file', type: 'file', accept: 'video/*' }}
        value={fileVal}
        onChange={() => {}}
        notebookId="zz-test-video"
      />
    );

    const videoElement = container.querySelector('video');
    expect(videoElement).not.toBeNull();
    expect(videoElement?.getAttribute('src')).toContain('/storage/clip.mp4');
  });

  it('renders Record again button when audio file is chosen and triggers recording reset', () => {
    const fileVal = JSON.stringify({
      name: 'voice.webm',
      path: 'storage/voice.webm',
      url: '/storage/voice.webm',
      size: 1024,
      mime: 'audio/webm',
    });

    const handleChange = vi.fn();

    const { getByText } = render(
      <FileField
        input={{ name: 'voice', type: 'file', accept: 'audio/*' }}
        value={fileVal}
        onChange={handleChange}
        notebookId="zz-test-audio"
      />
    );

    const reRecordButton = getByText('Record again');
    expect(reRecordButton).not.toBeNull();

    fireEvent.click(reRecordButton);
    expect(handleChange).toHaveBeenCalledWith('');
  });
});
