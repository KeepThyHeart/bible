/**
 * Per-book audio downloads for offline listening (task 0223), shared by web and desktop.
 *
 * The model: the reader picks a translation and a narrator, then books. Each book is one
 * pack item (`{ kind: 'audio', id: '<module>/<narrator>/<rev>/<book>' }`, see core
 * `PackTypes`) that lists its files: every recorded chapter's manifest plus the one audio
 * file this device plays (the first whose MIME type `canPlay` accepts), and the
 * translation's `index.json`. A book that is only partly recorded (the index's `chapters`
 * map) downloads what exists and says "N of M chapters".
 *
 * Downloading a translation's audio also downloads its text when it is not on the device
 * (`ensureText`, the app's own module install). Files are keyed by their URL under the
 * app's audio base, exactly the URL the player asks for, so playback finds them:
 *
 * - web: a pinned Cache API cache (`audio-downloads-v1`), separate from the evicting LRU of
 *   recently played chapters, read first by `RecordedAudioProvider` / `HttpManifestSource`;
 * - desktop: files on disk that its `kth-audio:` scheme serves before the network.
 *
 * Each app supplies only the storage (`IAudioDownloadStore`). Partial progress is kept:
 * files already stored are skipped, so the next run resumes.
 */

import { narratorHasChapter, pickPlayableFile } from '@bible/core/browser';
import type {
  AudioNarrator, ChapterManifest, IAudioLocator, IManifestSource, IPackInstaller, PackItemRef, PackOffer,
  TranslationAudioIndex,
} from '@bible/core/browser';
import { packKey } from '@bible/core/browser';
import { Store } from '../Store';

/** One file to keep, by the URL the player uses, with its size when known. */
export interface AudioDownloadFile {
  url: string;
  bytes: number;
  sha256?: string;
}

/** Where an app keeps downloaded files. Must never evict them on its own. */
export interface IAudioDownloadStore {
  /** Which of these URLs are stored (complete). */
  present(urls: readonly string[]): Promise<Set<string>>;
  /**
   * Store the files not yet present, one after another; report bytes as they arrive.
   * Rejects with an error whose `code` is 'aborted' when `signal` aborts (files finished so far stay).
   */
  fetch(files: readonly AudioDownloadFile[], opts: { signal: AbortSignal; onBytes(loaded: number): void }): Promise<void>;
  /** Delete these URLs. */
  remove(urls: readonly string[]): Promise<void>;
  /** Free bytes for downloads, or null when unknown (web: quota minus usage; desktop: free disk space). */
  freeBytes(): Promise<number | null>;
  /** Called once before the first download starts (web: `navigator.storage.persist()`). */
  persist?(): Promise<void>;
}

export type Testament = 'ot' | 'nt';

export const testamentOf = (book: number): Testament => (book <= 39 ? 'ot' : 'nt');

/** `KJV/amy/1/43`. Module and narrator ids may not contain '/'. */
export function audioBookId(module: string, narrator: string, rev: string, book: number): string {
  return `${module}/${narrator}/${rev}/${book}`;
}

export function parseAudioBookId(id: string): { module: string; narrator: string; rev: string; book: number } | null {
  const m = /^([^/]+)\/([^/]+)\/([^/]+)\/(\d{1,2})$/.exec(id);
  if (!m) return null;
  const book = Number(m[4]);
  return book >= 1 && book <= 66 ? { module: m[1], narrator: m[2], rev: m[3], book } : null;
}

export const audioPackRef = (id: string): PackItemRef => ({ kind: 'audio', id });

/** A book of one narrator, as the index describes it. */
export interface AudioBookEntry {
  id: string;
  book: number;
  testament: Testament;
  /** Recorded chapters, ascending. */
  chapters: number[];
  /** Chapters in the book (from the app), or the recorded count when unknown. */
  totalChapters: number;
  /** Fewer chapters recorded than the book has. */
  partial: boolean;
}

/** Every book a narrator has any recording of, in canonical order. */
export function narratorBooks(module: string, narrator: AudioNarrator, chapterCount: (book: number) => number): AudioBookEntry[] {
  const out: AudioBookEntry[] = [];
  for (let book = 1; book <= 66; book++) {
    const count = chapterCount(book);
    let chapters: number[];
    if (narrator.books.includes(book)) {
      chapters = count > 0 ? Array.from({ length: count }, (_, i) => i + 1) : [];
      if (chapters.length === 0) continue; // a full book whose length the app does not know: nothing to list
    } else {
      chapters = [...new Set(narrator.chapters?.[String(book)] ?? [])].filter(c => c >= 1).sort((a, b) => a - b);
      if (chapters.length === 0) continue;
    }
    const total = Math.max(count, chapters.length);
    out.push({
      id: audioBookId(module, narrator.id, narrator.rev, book), book, testament: testamentOf(book),
      chapters, totalChapters: total, partial: chapters.length < total,
    });
  }
  return out;
}

/** Files of one book for this device. Chapters whose manifest is missing are skipped. */
export async function bookFiles(
  module: string,
  narrator: AudioNarrator,
  entry: AudioBookEntry,
  deps: { manifests: IManifestSource; locator: IAudioLocator; canPlay(mime: string): boolean; signal: AbortSignal },
): Promise<AudioDownloadFile[]> {
  const files: AudioDownloadFile[] = [];
  for (const chapter of entry.chapters) {
    if (!narratorHasChapter(narrator, entry.book, chapter)) continue;
    const ref = { moduleAbbr: module, book: entry.book, chapter };
    const manifest: ChapterManifest | null = await deps.manifests.chapter(ref, narrator, deps.signal);
    if (!manifest) continue;
    const file = pickPlayableFile(manifest, deps.canPlay);
    if (!file) continue;
    // The manifest's own size is not recorded; a few KB (counted as 0 in the totals).
    files.push({ url: deps.locator.manifestUrl(ref, narrator.id, narrator.rev), bytes: 0 });
    files.push({ url: deps.locator.fileUrl(manifest, file), bytes: file.bytes, ...(file.sha256 ? { sha256: file.sha256 } : {}) });
  }
  return files;
}

/** "Whole Bible" and other large selections ask first above this size (and always when over free space). */
export const AUDIO_DOWNLOAD_WARN_BYTES = 500_000_000;

export type BookState = 'absent' | 'partial' | 'downloaded';

export interface AudioBookRow extends AudioBookEntry {
  /** Download size of what is recorded; null until its manifests have been read. */
  bytes: number | null;
  state: BookState;
}

export interface DownloadProgress {
  /** Books done and to do in this run. */
  done: number;
  total: number;
  loadedBytes: number;
  totalBytes: number;
  /** Book being downloaded. */
  current: number | null;
}

export type DownloadRunState = 'idle' | 'running' | 'done' | 'cancelled' | 'failed';

export interface AudioDownloadDeps {
  manifests: IManifestSource;
  locator: IAudioLocator;
  store: IAudioDownloadStore;
  canPlay(mime: string): boolean;
  chapterCount(book: number): number;
  /** Make sure the translation's text is on the device (download it if not). */
  ensureText(module: string, signal: AbortSignal): Promise<void>;
  /** Manifest reads at once while sizing books. Default 6. */
  concurrency?: number;
}

/**
 * The picker's state for one translation and narrator, framework-neutral (both apps draw it).
 * `open()` loads the index; sizes and states fill in as the manifests are read.
 */
export class AudioDownloadsModel extends Store {
  module: string | null = null;
  index: TranslationAudioIndex | null = null;
  narratorId: string | null = null;
  rows: AudioBookRow[] = [];
  selected = new Set<number>();
  loading = false;
  /** Error of the last load or run (message), null when fine. */
  error: string | null = null;
  run: DownloadRunState = 'idle';
  progress: DownloadProgress | null = null;

  private files = new Map<number, AudioDownloadFile[]>();
  private abort: AbortController | null = null;
  private loadSeq = 0;
  private persisted = false;

  constructor(private readonly deps: AudioDownloadDeps) {
    super();
  }

  get narrator(): AudioNarrator | null {
    return this.index?.narrators.find(n => n.id === this.narratorId) ?? null;
  }

  /** Load a translation's recordings index; picks its first narrator. */
  async open(module: string, signal: AbortSignal = new AbortController().signal): Promise<void> {
    const seq = ++this.loadSeq;
    this.module = module;
    this.index = null;
    this.rows = [];
    this.selected = new Set();
    this.files.clear();
    this.loading = true;
    this.error = null;
    this.notify();
    try {
      const index = await this.deps.manifests.translationIndex(module, signal);
      if (seq !== this.loadSeq) return;
      this.index = index;
      this.loading = false;
      this.notify();
      if (index?.narrators[0]) await this.chooseNarrator(index.narrators[0].id, signal);
    } catch (e) {
      if (seq !== this.loadSeq) return;
      this.loading = false;
      this.error = e instanceof Error ? e.message : String(e);
      this.notify();
    }
  }

  async chooseNarrator(narratorId: string, signal: AbortSignal = new AbortController().signal): Promise<void> {
    const seq = ++this.loadSeq;
    const module = this.module;
    const narrator = this.index?.narrators.find(n => n.id === narratorId);
    if (!module || !narrator) return;
    this.narratorId = narratorId;
    this.selected = new Set();
    this.files.clear();
    this.rows = narratorBooks(module, narrator, this.deps.chapterCount).map(e => ({ ...e, bytes: null, state: 'absent' }));
    this.notify();
    await this.sizeBooks(seq, module, narrator, signal);
  }

  /** Read each book's manifests (a few at a time) for sizes and download states. */
  private async sizeBooks(seq: number, module: string, narrator: AudioNarrator, signal: AbortSignal): Promise<void> {
    const queue = [...this.rows];
    const worker = async () => {
      for (;;) {
        const row = queue.shift();
        if (!row || seq !== this.loadSeq || signal.aborted) return;
        try {
          await this.refreshRow(row.book, module, narrator, signal);
        } catch { /* the row stays without a size */ }
        if (seq === this.loadSeq) this.notify();
      }
    };
    await Promise.all(Array.from({ length: this.deps.concurrency ?? 6 }, worker));
  }

  private async filesOf(book: number, module: string, narrator: AudioNarrator, signal: AbortSignal): Promise<AudioDownloadFile[]> {
    const have = this.files.get(book);
    if (have) return have;
    const entry = this.rows.find(r => r.book === book);
    if (!entry) return [];
    const files = await bookFiles(module, narrator, entry, { ...this.deps, signal });
    this.files.set(book, files);
    return files;
  }

  private async refreshRow(book: number, module: string, narrator: AudioNarrator, signal: AbortSignal): Promise<void> {
    const files = await this.filesOf(book, module, narrator, signal);
    const present = await this.deps.store.present(files.map(f => f.url));
    const row = this.rows.find(r => r.book === book);
    if (!row) return;
    row.bytes = files.reduce((s, f) => s + f.bytes, 0);
    const n = files.filter(f => present.has(f.url)).length;
    row.state = files.length > 0 && n === files.length ? 'downloaded' : n > 0 ? 'partial' : 'absent';
  }

  // ------------------------------------------------------------ selection

  toggle(book: number): void {
    if (this.selected.has(book)) this.selected.delete(book); else this.selected.add(book);
    this.selected = new Set(this.selected);
    this.notify();
  }

  /** Select (or clear) every book of a testament that is not fully downloaded. */
  selectTestament(t: Testament, on = true): void {
    for (const r of this.rows) {
      if (r.testament !== t || r.state === 'downloaded') continue;
      if (on) this.selected.add(r.book); else this.selected.delete(r.book);
    }
    this.selected = new Set(this.selected);
    this.notify();
  }

  /** The "Whole Bible" preset: every book not yet downloaded. */
  selectWholeBible(): void {
    this.selected = new Set(this.rows.filter(r => r.state !== 'downloaded').map(r => r.book));
    this.notify();
  }

  clearSelection(): void {
    this.selected = new Set();
    this.notify();
  }

  /** Bytes of the selection (null while any selected book is not sized yet). */
  get selectedBytes(): number | null {
    let sum = 0;
    for (const r of this.rows) {
      if (!this.selected.has(r.book)) continue;
      if (r.bytes === null) return null;
      sum += r.bytes;
    }
    return sum;
  }

  /** Bytes of every listed book (the Whole Bible total), null until all are sized. */
  get totalBytes(): number | null {
    let sum = 0;
    for (const r of this.rows) {
      if (r.bytes === null) return null;
      sum += r.bytes;
    }
    return sum;
  }

  /** Before starting: is a warning step needed, and does it fit? */
  async check(): Promise<{ bytes: number | null; free: number | null; fits: boolean | null; warn: boolean }> {
    const bytes = this.selectedBytes;
    const free = await this.deps.store.freeBytes().catch(() => null);
    const fits = bytes === null || free === null ? null : bytes <= free;
    return { bytes, free, fits, warn: fits === false || (bytes ?? 0) >= AUDIO_DOWNLOAD_WARN_BYTES };
  }

  // ------------------------------------------------------------ run

  /** Download the selected books, text first. Cancel keeps what finished; the next run resumes. */
  async download(): Promise<void> {
    const module = this.module;
    const narrator = this.narrator;
    if (!module || !narrator || this.run === 'running' || this.selected.size === 0) return;
    const books = this.rows.filter(r => this.selected.has(r.book)).map(r => r.book);
    const abort = new AbortController();
    this.abort = abort;
    this.run = 'running';
    this.error = null;
    this.progress = { done: 0, total: books.length, loadedBytes: 0, totalBytes: this.selectedBytes ?? 0, current: null };
    this.notify();
    try {
      if (!this.persisted) { this.persisted = true; await this.deps.store.persist?.().catch(() => {}); }
      await this.deps.ensureText(module, abort.signal);
      // The index too, so the translation is known to have recordings with the network off.
      // It is the one file that changes (new narrators, revisions), so every run refreshes it; a
      // stored copy is kept when the refresh fails.
      const indexFile = { url: this.deps.locator.indexUrl(module), bytes: 0 };
      const hadIndex = (await this.deps.store.present([indexFile.url])).has(indexFile.url);
      try {
        await this.deps.store.fetch([indexFile], { signal: abort.signal, onBytes: () => {} });
      } catch (e) {
        if (!hadIndex || abort.signal.aborted) throw e;
      }
      let base = 0;
      for (const book of books) {
        if (abort.signal.aborted) throw Object.assign(new Error('aborted'), { code: 'aborted' });
        this.progress = { ...this.progress!, current: book };
        this.notify();
        const files = await this.filesOf(book, module, narrator, abort.signal);
        const present = await this.deps.store.present(files.map(f => f.url));
        const missing = files.filter(f => !present.has(f.url));
        base += files.filter(f => present.has(f.url)).reduce((s, f) => s + f.bytes, 0);
        const start = base;
        await this.deps.store.fetch(missing, {
          signal: abort.signal,
          onBytes: loaded => { this.progress = { ...this.progress!, loadedBytes: start + loaded }; this.notify(); },
        });
        base = start + missing.reduce((s, f) => s + f.bytes, 0);
        await this.refreshRow(book, module, narrator, abort.signal);
        this.selected.delete(book);
        this.progress = { ...this.progress!, done: this.progress!.done + 1, loadedBytes: base };
        this.notify();
      }
      this.run = 'done';
    } catch (e) {
      const aborted = abort.signal.aborted || (e as { code?: string })?.code === 'aborted';
      this.run = aborted ? 'cancelled' : 'failed';
      if (!aborted) this.error = e instanceof Error ? e.message : String(e);
      // Rows reflect what is now stored (a cancelled book may be partial).
      for (const book of books) await this.refreshRow(book, module, narrator, new AbortController().signal).catch(() => {});
    } finally {
      this.abort = null;
      this.selected = new Set(this.selected);
      this.progress = this.progress ? { ...this.progress, current: null } : null;
      this.notify();
    }
  }

  cancel(): void {
    this.abort?.abort();
  }

  /** Delete one book's downloaded files. */
  async remove(book: number): Promise<void> {
    const module = this.module;
    const narrator = this.narrator;
    if (!module || !narrator) return;
    const signal = new AbortController().signal;
    const files = await this.filesOf(book, module, narrator, signal);
    await this.deps.store.remove(files.map(f => f.url));
    await this.refreshRow(book, module, narrator, signal);
    this.notify();
  }
}

/** A downloaded book as a pack offer (so packs can carry audio books); requires its text module. */
export function audioBookOffer(row: AudioBookRow, opts: { moduleRef: PackItemRef; title: string; language?: string; version: string }): PackOffer {
  const ref = audioPackRef(row.id);
  return {
    ref,
    key: packKey(ref),
    title: opts.title,
    group: 'audio',
    ...(opts.language ? { language: opts.language } : {}),
    version: opts.version,
    downloadBytes: row.bytes ?? 0,
    storedBytes: row.bytes ?? 0,
    requires: [opts.moduleRef],
    offlineReadable: true,
    status: row.state === 'downloaded' ? 'installed' : 'absent',
  };
}

/**
 * The `IPackInstaller` for `audio` items: lists the book's files (`filesOf`, e.g. through an
 * `AudioDownloadsModel` or `bookFiles`) and stores the missing ones. The text module is a
 * separate pack step (`requires`), installed first by the planner.
 */
export function createAudioPackInstaller(deps: {
  filesOf(id: string, signal: AbortSignal): Promise<AudioDownloadFile[]>;
  store: IAudioDownloadStore;
}): IPackInstaller {
  return {
    async install(step, ctx) {
      const files = await deps.filesOf(step.offer.ref.id, ctx.signal);
      const present = await deps.store.present(files.map(f => f.url));
      const missing = files.filter(f => !present.has(f.url));
      const total = missing.reduce((s, f) => s + f.bytes, 0);
      await deps.store.fetch(missing, { signal: ctx.signal, onBytes: loaded => ctx.onBytes(loaded, total) });
    },
  };
}
