/** The downloads picker over the real model with fakes: grouping, select-all per testament, the Whole Bible step, progress, cancel, remove, offline. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

import { buildFixtureManifest } from '@bible/core/browser';
import type { ChapterManifest, TranslationAudioIndex } from '@bible/core/browser';
import { AudioDownloadsModel, CdnAudioLocator } from '@bible/audio';
import type { AudioDownloadFile, IAudioDownloadStore } from '@bible/audio';
import { FakeManifestSource } from '@bible/audio/testing';
import { renderAudio } from '../components/audioTestRig';
import { AudioDownloadsPanel } from './AudioDownloadsPanel';
import { ensureModuleText, offlineAware } from './AudioDownloads';

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
  failWith: (Error & { code?: string }) | null = null;
  async present(urls: readonly string[]) { return new Set(urls.filter((u) => this.stored.has(u))); }
  async fetch(files: readonly AudioDownloadFile[], opts: { signal: AbortSignal; onBytes(n: number): void }) {
    if (this.failWith) throw this.failWith;
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
    manifests: manifests(), locator: new CdnAudioLocator('/audio'), store: offlineAware(store),
    canPlay: () => true, chapterCount: (b) => counts[b] ?? 0, ensureText: vi.fn(async () => {}),
  });
  renderAudio(<AudioDownloadsPanel model={model} modules={[{ abbreviation: 'KJV' }]} bookName={(b) => `Book ${b}`} />, { pane: false });
  return { model, store };
}

afterEach(() => cleanup());

const sized = (n: number) => waitFor(() => expect(screen.getByTestId(`audio-dl-book-${n}`).textContent).not.toContain('size loading'));

describe('AudioDownloadsPanel', () => {
  it('groups books by testament, labels checkboxes by book name and shows "N of M chapters" for a partly recorded book', async () => {
    setup();
    await sized(40);
    expect(screen.getByRole('region', { name: 'Old Testament' }).textContent).toContain('Book 1');
    expect(screen.getByRole('region', { name: 'New Testament' }).textContent).toContain('Book 43');
    expect(screen.getByRole('checkbox', { name: 'Book 43' })).toBeTruthy();
    expect(screen.getByTestId('audio-dl-book-40').textContent).toContain('2 of 3 chapters');
    expect(screen.queryByTestId('audio-dl-narrator')).toBeNull(); // one narrator: no select
  });

  it('Select all works per testament and the total follows the selection', async () => {
    setup();
    await sized(43);
    fireEvent.click(screen.getByRole('button', { name: 'Select all books in the New Testament' }));
    await waitFor(() => expect((screen.getByRole('checkbox', { name: 'Book 43' }) as HTMLInputElement).checked).toBe(true));
    expect((screen.getByRole('checkbox', { name: 'Book 40' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: 'Book 1' }) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByTestId('audio-dl-summary').textContent).toContain('2 books selected');
    // The group button now clears.
    fireEvent.click(screen.getByRole('button', { name: 'Clear the selection in the New Testament' }));
    await waitFor(() => expect((screen.getByRole('checkbox', { name: 'Book 43' }) as HTMLInputElement).checked).toBe(false));
  });

  it('downloads with a live status, then Remove deletes the book and focus lands on its checkbox', async () => {
    const { model, store } = setup();
    await sized(43);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Book 1' }));
    fireEvent.click(screen.getByTestId('audio-dl-start'));
    await waitFor(() => expect(screen.getByTestId('audio-dl-status').textContent).toBe('The download finished.'));
    expect(screen.getByTestId('audio-dl-status').getAttribute('aria-live')).toBe('polite');
    expect(model.rows.find((r) => r.book === 1)?.state).toBe('downloaded');
    expect(store.stored.size).toBeGreaterThan(0);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Book 1 from this device' }));
    await waitFor(() => expect(model.rows.find((r) => r.book === 1)?.state).toBe('absent'));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('checkbox', { name: 'Book 1' })));
  });

  it('Whole Bible asks first with the total; Back starts nothing and confirming downloads everything', async () => {
    const { model, store } = setup();
    await sized(43);
    fireEvent.click(screen.getByTestId('audio-dl-whole'));
    fireEvent.click(screen.getByTestId('audio-dl-start'));
    const dialog = await screen.findByTestId('confirm-dialog');
    expect(dialog.textContent).toContain('Large download');
    expect(dialog.textContent).toMatch(/This download is \d/);
    expect(store.stored.size).toBe(0);
    fireEvent.click(screen.getByText('Back'));
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
    expect(store.stored.size).toBe(0);
    fireEvent.click(screen.getByTestId('audio-dl-start'));
    fireEvent.click(await screen.findByText('Download anyway'));
    await waitFor(() => expect(model.run).toBe('done'));
    expect(model.rows.every((r) => r.state === 'downloaded')).toBe(true);
  });

  it('a selection larger than the free space says so and does not start', async () => {
    const store = new MemStore();
    store.free = 100;
    setup(store);
    await sized(43);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Book 43' }));
    expect((await screen.findByTestId('audio-dl-nofit')).textContent).toContain('larger than the free space');
    expect((screen.getByTestId('audio-dl-start') as HTMLButtonElement).disabled).toBe(true);
    expect(store.stored.size).toBe(0);
  });

  it('with everything downloaded there is no group button and Whole Bible is disabled', async () => {
    const { model } = setup();
    await sized(43);
    fireEvent.click(screen.getByTestId('audio-dl-whole'));
    fireEvent.click(screen.getByTestId('audio-dl-start'));
    fireEvent.click(await screen.findByText('Download anyway'));
    await waitFor(() => expect(model.run).toBe('done'));
    expect(screen.queryAllByRole('button', { name: /books in the|selection in the/ })).toHaveLength(0);
    expect((screen.getByTestId('audio-dl-whole') as HTMLButtonElement).disabled).toBe(true);
  });

  it('leaving the panel does not cancel a running download', async () => {
    const store = new MemStore();
    let release!: () => void;
    store.hold = new Promise<void>((r) => { release = r; });
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

  it('Cancel keeps progress and says the next download continues', async () => {
    const store = new MemStore();
    let release!: () => void;
    store.hold = new Promise<void>((r) => { release = r; });
    const { model } = setup(store);
    await sized(43);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Book 43' }));
    fireEvent.click(screen.getByTestId('audio-dl-start'));
    const cancel = await screen.findByTestId('audio-dl-cancel');
    expect(screen.getByTestId('audio-dl-progress')).toBeTruthy();
    expect(screen.getByTestId('audio-dl-status').textContent).toMatch(/Downloading.* 1 of 1 books/);
    fireEvent.click(cancel);
    release();
    await waitFor(() => expect(model.run).toBe('cancelled'));
    expect(screen.getByTestId('audio-dl-status').textContent).toContain('Progress is kept');
  });

  it('shows the network-off message when the store refuses with the offline code', async () => {
    const store = new MemStore();
    store.failWith = Object.assign(new Error('Web requests are turned off'), { code: 'offline' });
    const { model } = setup(store);
    await sized(43);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Book 43' }));
    fireEvent.click(screen.getByTestId('audio-dl-start'));
    await waitFor(() => expect(model.run).toBe('failed'));
    expect(screen.getByTestId('audio-dl-status').textContent).toBe('Network access is off. Turn it on in Preferences to download.');
  });
});

describe('ensureModuleText', () => {
  const make = (installedAt: number) => {
    let polls = 0;
    const start = vi.fn(async () => {});
    return {
      start,
      installer: {
        isInstalled: () => polls >= installedAt,
        catalogId: () => '12',
        start,
        reload: async () => { polls++; },
      },
    };
  };
  it('is a no-op when the text is installed', async () => {
    const { installer, start } = make(0);
    await ensureModuleText('KJV', new AbortController().signal, installer, 1);
    expect(start).not.toHaveBeenCalled();
  });
  it('queues the install and waits for it otherwise', async () => {
    const { installer, start } = make(2);
    await ensureModuleText('KJV', new AbortController().signal, installer, 1);
    expect(start).toHaveBeenCalledWith('12');
  });
  it('stops waiting when aborted', async () => {
    const { installer } = make(99);
    const ctl = new AbortController();
    ctl.abort();
    await expect(ensureModuleText('KJV', ctl.signal, installer, 1)).rejects.toMatchObject({ code: 'aborted' });
  });
});
