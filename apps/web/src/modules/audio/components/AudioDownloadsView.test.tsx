/** The offline downloads view over the real model with a fake store: selection, warning, progress, remove. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/preact';

vi.mock('react-i18next', async importOriginal => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => (opts ? `${key}${JSON.stringify(opts)}` : key),
    i18n: { language: 'en' },
  }),
}));

import { buildFixtureManifest } from '@bible/core/browser';
import type { ChapterManifest, TranslationAudioIndex } from '@bible/core/browser';
import { AudioDownloadsModel, CdnAudioLocator } from '@bible/audio';
import type { AudioDownloadFile, IAudioDownloadStore } from '@bible/audio';
import { FakeManifestSource } from '@bible/audio/testing';
import { AudioDownloadsView } from './AudioDownloadsView';

const counts: Record<number, number> = { 1: 2, 40: 3, 43: 3 };

function manifests(): FakeManifestSource {
  const index: TranslationAudioIndex = {
    schema: 'kth-audio-index/1', module: 'KJV',
    narrators: [{ id: 'amy', label: 'Amy', language: 'en', rev: '1', books: [1, 43], chapters: { '40': [1, 3] } }],
  };
  const m: Record<string, ChapterManifest> = {};
  const add = (book: number, chapter: number, bytes: number) => {
    const ccc = String(chapter).padStart(3, '0');
    m[`KJV:${book}:${chapter}`] = buildFixtureManifest({
      module: 'KJV', narrator: 'amy', rev: '1', book, chapter, verseCount: 3,
      files: [{ codec: 'opus', mime: 'audio/ogg; codecs=opus', path: `${book}/${ccc}.ogg`, bytes }],
    });
  };
  add(1, 1, 1000); add(1, 2, 1000); add(40, 1, 1000); add(40, 3, 1000); add(43, 1, 1000); add(43, 2, 1000); add(43, 3, 1000);
  return new FakeManifestSource({ KJV: index }, m);
}

class MemStore implements IAudioDownloadStore {
  stored = new Set<string>();
  free: number | null = 10_000_000;
  hold: Promise<void> | null = null;
  async present(urls: readonly string[]) { return new Set(urls.filter(u => this.stored.has(u))); }
  async fetch(files: readonly AudioDownloadFile[], opts: { signal: AbortSignal; onBytes(n: number): void }) {
    let n = 0;
    for (const f of files) {
      if (this.hold) await this.hold;
      if (opts.signal.aborted) throw Object.assign(new Error('aborted'), { code: 'aborted' });
      this.stored.add(f.url);
      n += f.bytes;
      opts.onBytes(n);
    }
  }
  async remove(urls: readonly string[]) { for (const u of urls) this.stored.delete(u); }
  async freeBytes() { return this.free; }
}

function setup(store = new MemStore()) {
  const model = new AudioDownloadsModel({
    manifests: manifests(), locator: new CdnAudioLocator('/audio'), store,
    canPlay: () => true, chapterCount: b => counts[b] ?? 0, ensureText: vi.fn(async () => {}),
  });
  render(<AudioDownloadsView model={model} moduleAbbr="KJV" modules={[{ abbreviation: 'KJV' }]} bookName={b => `Book ${b}`} />);
  return { model, store };
}

afterEach(() => cleanup());

const sized = (n: number) => waitFor(() => expect(screen.getByTestId(`audio-dl-book-${n}`).textContent).not.toContain('sizeLoading'));

describe('AudioDownloadsView', () => {
  it('groups books by testament, labels checkboxes by book name and shows "N of M chapters" for a partly recorded book', async () => {
    setup();
    await sized(40);
    const ot = screen.getByRole('region', { name: 'audio.downloads.ot' });
    const nt = screen.getByRole('region', { name: 'audio.downloads.nt' });
    expect(ot.textContent).toContain('Book 1');
    expect(nt.textContent).toContain('Book 43');
    expect(screen.getByRole('checkbox', { name: 'Book 43' })).toBeTruthy();
    expect(screen.getByTestId('audio-dl-book-40').textContent).toContain('"count":2,"total":3');
  });

  it('selects a testament, shows the selection total, and downloads with progress, then Remove deletes the book', async () => {
    const { model, store } = setup();
    await sized(43);
    fireEvent.click(screen.getAllByRole('button', { name: /audio.downloads.selectGroup/ })[0]);
    await waitFor(() => expect((screen.getByRole('checkbox', { name: 'Book 1' }) as HTMLInputElement).checked).toBe(true));
    expect(screen.getByTestId('audio-dl-summary').textContent).toContain('"count":1');
    fireEvent.click(screen.getByTestId('audio-dl-start'));
    await waitFor(() => expect(screen.getByTestId('audio-dl-status').textContent).toContain('audio.downloads.done'));
    expect(model.rows.find(r => r.book === 1)?.state).toBe('downloaded');
    expect(store.stored.size).toBeGreaterThan(0);
    const remove = await screen.findByRole('button', { name: /audio.downloads.removeBook.*Book 1/ });
    fireEvent.click(remove);
    await waitFor(() => expect(model.rows.find(r => r.book === 1)?.state).toBe('absent'));
  });

  it('Whole Bible asks first with the total; Back changes nothing and confirming downloads', async () => {
    const { model, store } = setup();
    await sized(43);
    fireEvent.click(screen.getByTestId('audio-dl-whole'));
    fireEvent.click(screen.getByTestId('audio-dl-start'));
    const confirm = await screen.findByTestId('audio-dl-confirm');
    expect(confirm.textContent).toContain('audio.downloads.confirmBody');
    expect(store.stored.size).toBe(0);
    fireEvent.click(screen.getByText('audio.downloads.back'));
    expect(screen.queryByTestId('audio-dl-confirm')).toBeNull();
    fireEvent.click(screen.getByTestId('audio-dl-start'));
    fireEvent.click(await screen.findByTestId('audio-dl-confirm-go'));
    await waitFor(() => expect(model.run).toBe('done'));
    expect(model.rows.every(r => r.state === 'downloaded')).toBe(true);
  });

  it('a selection that does not fit the free space cannot start', async () => {
    const store = new MemStore();
    store.free = 100;
    setup(store);
    await sized(43);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Book 43' }));
    await screen.findByTestId('audio-dl-nofit');
    expect((screen.getByTestId('audio-dl-start') as HTMLButtonElement).disabled).toBe(true);
    expect(store.stored.size).toBe(0);
  });

  it('hides the group button when the testament is fully downloaded and disables Whole Bible', async () => {
    const { model } = setup();
    await sized(43);
    fireEvent.click(screen.getByTestId('audio-dl-whole'));
    fireEvent.click(screen.getByTestId('audio-dl-start'));
    fireEvent.click(await screen.findByTestId('audio-dl-confirm-go'));
    await waitFor(() => expect(model.run).toBe('done'));
    expect(screen.queryAllByRole('button', { name: /audio.downloads.(select|clear)Group/ })).toHaveLength(0);
    expect((screen.getByTestId('audio-dl-whole') as HTMLButtonElement).disabled).toBe(true);
  });

  it('leaving the view does not cancel a running download', async () => {
    const store = new MemStore();
    let release!: () => void;
    store.hold = new Promise<void>(r => { release = r; });
    const { model } = setup(store);
    await sized(43);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Book 43' }));
    fireEvent.click(screen.getByTestId('audio-dl-start'));
    await screen.findByTestId('audio-dl-cancel');
    cleanup();
    expect(model.run).toBe('running');
    release();
    await waitFor(() => expect(model.run).toBe('done'));
  });

  it('Cancel keeps what finished and says progress is kept', async () => {
    const store = new MemStore();
    let release!: () => void;
    store.hold = new Promise<void>(r => { release = r; });
    const { model } = setup(store);
    await sized(43);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Book 43' }));
    fireEvent.click(screen.getByTestId('audio-dl-start'));
    const cancel = await screen.findByTestId('audio-dl-cancel');
    expect(screen.getByTestId('audio-dl-progress')).toBeTruthy();
    fireEvent.click(cancel);
    release();
    await waitFor(() => expect(model.run).toBe('cancelled'));
    expect(screen.getByTestId('audio-dl-status').textContent).toContain('audio.downloads.cancelled');
  });
});
