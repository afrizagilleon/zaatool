import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import type { NotebookPage } from '@zaa-tool/shared';
import { mediaSource } from '../src/lib/media-source';
import { FileField } from '../src/components/pages/render/FileField';


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

describe('FileField inline preview & duration (T-01, T-02)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders audio player for audio chosen file (T-01)', () => {
    const fileVal = JSON.stringify({
      name: 'voice.mp3',
      path: 'storage/voice.mp3',
      url: '/storage/voice.mp3',
      size: 1024,
      mime: 'audio/mp3',
    });

    const { container } = render(
      <FileField
        input={{ name: 'voice', type: 'file', accept: 'audio/*' }}
        value={fileVal}
        onChange={() => {}}
        notebookId="zz-test"
      />
    );

    const audioElement = container.querySelector('audio');
    expect(audioElement).not.toBeNull();
    expect(audioElement?.getAttribute('src')).toContain('/storage/voice.mp3');
  });

  it('renders image preview thumbnail for image chosen file (T-01)', () => {
    const fileVal = JSON.stringify({
      name: 'pic.png',
      path: 'storage/pic.png',
      url: '/storage/pic.png',
      size: 2048,
      mime: 'image/png',
    });

    const { container } = render(
      <FileField
        input={{ name: 'photo', type: 'file', accept: 'image/*' }}
        value={fileVal}
        onChange={() => {}}
        notebookId="zz-test"
      />
    );

    const imgElement = container.querySelector('img');
    expect(imgElement).not.toBeNull();
    expect(imgElement?.getAttribute('src')).toContain('/storage/pic.png');
  });
});

describe('RendererGallery audio and video cases (T-03)', () => {
  it('renders audio and video controls in RendererGallery', async () => {
    const { RendererGallery } = await import('../src/components/pages/RendererGallery');
    const { container } = render(<RendererGallery />);

    const audioElements = container.querySelectorAll('audio');
    const videoElements = container.querySelectorAll('video');

    expect(audioElements.length).toBeGreaterThan(0);
    expect(videoElements.length).toBeGreaterThan(0);
  });
});

describe('NotesBlock (T-04)', () => {
  it('renders prose notes correctly using Markdown and remarkGfm', async () => {
    const { NotesBlock } = await import('../src/components/pages/render/NotesBlock');
    const { container } = render(<NotesBlock notes={['# Heading Note', 'Prose paragraph.']} />);

    const h1Element = container.querySelector('h1');
    expect(h1Element).not.toBeNull();
    expect(h1Element?.textContent).toBe('Heading Note');
    expect(container.textContent).toContain('Prose paragraph.');
  });
});

describe('honest error message on media load error (T-06)', () => {
  it('displays link expired message when media fails to load', async () => {
    const { OutputView } = await import('../src/components/pages/render/OutputView');
    const { container } = render(
      <OutputView output={{ name: 'img', render: 'image' }} value="http://invalid.url/nonexistent.jpg" />
    );

    const img = container.querySelector('img');
    expect(img).not.toBeNull();

    if (img) {
      fireEvent.error(img);
    }

    expect(container.textContent).toContain("Couldn't load this file — its link may have expired");
  });
});

describe('un-run page state (T-07)', () => {
  it('renders prompt for pages that have never been run', async () => {
    const { PageRunner } = await import('../src/components/pages/AppsPage');
    const page = {
      id: 'test-page',
      name: 'Unrun Page',
      inputs: [],
      outputs: [{ name: 'out1', render: 'text' }],
      actions: [],
      layout: [],
      notes: [],
      tags: [],
    };

    const { container } = render(
      <PageRunner page={page as unknown as NotebookPage} latest={null} onReload={() => {}} onBack={() => {}} />
    );


    expect(container.textContent).toContain('This page has not been run yet');
  });
});

describe('tileTitle helper (T-08)', () => {
  it('prefers description over name when description is non-empty', async () => {
    const { tileTitle } = await import('../src/lib/tile-title');
    expect(tileTitle({ name: 'top_products', description: 'Top 5 Products' })).toBe('Top 5 Products');
    expect(tileTitle({ name: 'top_products', description: '   ' })).toBe('top_products');
    expect(tileTitle({ name: 'top_products' })).toBe('top_products');
  });
});

describe('exportToCsv (T-10)', () => {
  it('serializes table rows to CSV with proper escaping for quotes, commas, and newlines', async () => {
    const { exportToCsv } = await import('../src/components/pages/render/TableView');

    const columns = ['id', 'name', 'comment'];
    const rows = [
      { id: 1, name: 'Alice, B.', comment: 'Hello "World"' },
      { id: 2, name: 'Bob', comment: 'Line1\nLine2' },
    ];

    const csv = exportToCsv(columns, rows);

    expect(csv).toContain('id,name,comment');
    expect(csv).toContain('1,"Alice, B.","Hello ""World"""');
    expect(csv).toContain('2,Bob,"Line1\nLine2"');
  });
});

describe('formatCopyValue (T-11)', () => {
  it('formats scalar, json, and table values for copying to clipboard', async () => {
    const { formatCopyValue } = await import('../src/components/pages/render/CopyTileValueButton');

    expect(formatCopyValue('plain text')).toBe('plain text');
    expect(formatCopyValue({ a: 1, b: 'test' })).toBe(JSON.stringify({ a: 1, b: 'test' }, null, 2));

    const rows = [{ col1: 'val1', col2: 'val2' }];
    const tableCsv = formatCopyValue(rows);
    expect(tableCsv).toContain('col1,col2');
    expect(tableCsv).toContain('val1,val2');
  });
});








