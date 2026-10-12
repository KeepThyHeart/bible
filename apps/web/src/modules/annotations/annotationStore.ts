/**
 * Per-tab chapter cache of the user's highlights, notes and bookmarks (lazy chunk).
 *
 * The reader's paint controller `watch`es a tab's chapter; entries are keyed `moduleId:start-end` and shared by tabs
 * showing the same chapter. Data comes from the worker's `annotations` repo (one round trip per chapter) and is
 * refetched, coalesced, after our own writes and on the worker's `changed` event for its tables (other tabs, sync pulls).
 * Consumers read `revision` through `useStore(store, () => store.revision)`.
 */
import { Store } from '../../stores/Store';
import type { AnnotationsRepo, BookmarkDto, ChapterAnnotations, HighlightDto, NoteDto } from '../../userdb/annotationsRepo';

export type AnnotationsApi = AnnotationsRepo;

/** Tables whose `changed` event refreshes the cache. */
export const ANNOTATION_TABLES: readonly string[] = ['user_text_markup', 'user_note', 'note_verse_link', 'verse_link', 'collection', 'pinned_item'];

export interface VerseAnnotations {
  readonly highlight?: HighlightDto;
  readonly notes: readonly NoteDto[];
  readonly bookmark?: BookmarkDto;
}

interface Entry {
  readonly key: string;
  readonly moduleId: number;
  readonly start: number;
  readonly end: number;
  refs: number;
  data: ChapterAnnotations | null;
  byVerse: Map<number, VerseAnnotations>;
  seq: number;
}

const rangeKey = (moduleId: number, start: number, end: number) => `${moduleId}:${start}-${end}`;

function index(entry: Entry, data: ChapterAnnotations): Map<number, VerseAnnotations> {
  type Draft = { highlight?: HighlightDto; notes: NoteDto[]; bookmark?: BookmarkDto };
  const drafts = new Map<number, Draft>();
  const at = (id: number): Draft => {
    let d = drafts.get(id);
    if (!d) drafts.set(id, (d = { notes: [] }));
    return d;
  };
  const clip = (s: number, e: number, fn: (id: number) => void) => {
    for (let id = Math.max(s, entry.start); id <= Math.min(e, entry.end); id++) fn(id);
  };
  for (const h of [...data.highlights].sort((a, b) => a.id - b.id)) clip(h.start, h.end, (id) => { at(id).highlight = h; });
  for (const n of [...data.notes].sort((a, b) => a.modified.localeCompare(b.modified))) clip(n.start, n.end, (id) => { at(id).notes.unshift(n); });
  for (const b of data.bookmarks) clip(b.start, b.end, (id) => { at(id).bookmark ??= b; });
  return drafts as Map<number, VerseAnnotations>;
}

export class AnnotationStore extends Store {
  private entries = new Map<string, Entry>();
  private tabs = new Map<string, string>();
  private version = 0;
  private refreshing = false;
  private dirty = false;
  private unlisten: (() => void) | null = null;

  constructor(private readonly getApi: () => Promise<AnnotationsApi>) {
    super();
  }

  /** Changes whenever any entry (or the set of watched chapters) does. */
  get revision(): number {
    return this.version;
  }

  /** Follow `changed` events from the worker. `subscribeChanged` returns its unsubscribe. */
  listen(subscribeChanged: (cb: (tables: readonly string[]) => void) => () => void): () => void {
    this.unlisten?.();
    this.unlisten = subscribeChanged((tables) => {
      if (tables.some((t) => ANNOTATION_TABLES.includes(t))) this.refresh();
    });
    return () => {
      this.unlisten?.();
      this.unlisten = null;
    };
  }

  /** Register interest of one tab in a chapter; dispose when the tab leaves it. */
  watch(tabId: string, moduleId: number, start: number, end: number): () => void {
    const key = rangeKey(moduleId, start, end);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { key, moduleId, start, end, refs: 0, data: null, byVerse: new Map(), seq: 0 };
      this.entries.set(key, entry);
      void this.load(entry);
    }
    entry.refs++;
    this.tabs.set(tabId, key);
    this.bump();
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const e = this.entries.get(key);
      if (!e) return;
      if (--e.refs <= 0) this.entries.delete(key);
      if (this.tabs.get(tabId) === key) this.tabs.delete(tabId);
      this.bump();
    };
  }

  /** What the tab's chapter holds for one verse; undefined while nothing is known or there is nothing. */
  forVerse(tabId: string, verseId: number): VerseAnnotations | undefined {
    const key = this.tabs.get(tabId);
    return key ? this.entries.get(key)?.byVerse.get(verseId) : undefined;
  }

  /** Fresh data for any range (the verse might not be in a watched chapter). */
  async fetch(moduleId: number, start: number, end: number): Promise<ChapterAnnotations> {
    return (await this.getApi()).getChapter(moduleId, start, end);
  }

  /** Refetch every watched chapter (coalesced). */
  refresh(): void {
    if (this.refreshing) {
      this.dirty = true;
      return;
    }
    this.refreshing = true;
    void (async () => {
      try {
        do {
          this.dirty = false;
          await Promise.all([...this.entries.values()].map((e) => this.load(e)));
        } while (this.dirty);
      } finally {
        this.refreshing = false;
      }
    })();
  }

  private async load(entry: Entry): Promise<void> {
    const seq = ++entry.seq;
    try {
      const data = await this.fetch(entry.moduleId, entry.start, entry.end);
      if (seq !== entry.seq || this.entries.get(entry.key) !== entry) return;
      entry.data = data;
      entry.byVerse = index(entry, data);
      this.bump();
    } catch (err) {
      console.warn('[annotations] could not load the chapter', err);
    }
  }

  private bump(): void {
    this.version++;
    this.notify();
  }

  // --- writes: each refreshes the cache afterwards ---------------------------------------------

  private async write<T>(fn: (api: AnnotationsApi) => Promise<T>): Promise<T> {
    const out = await fn(await this.getApi());
    this.refresh();
    return out;
  }

  setHighlight(moduleId: number, start: number, end: number, color: string): Promise<HighlightDto> {
    return this.write((api) => api.setHighlight({ moduleId, start, end, color }));
  }

  /** Remove every whole-verse highlight of the module that overlaps the range. Returns how many were removed. */
  async removeHighlights(moduleId: number, start: number, end: number): Promise<number> {
    const { highlights } = await this.fetch(moduleId, start, end);
    return this.write(async (api) => {
      let n = 0;
      for (const h of highlights) n += await api.removeHighlight({ moduleId, start: h.start, end: h.end });
      return n;
    });
  }

  saveNote(a: { id?: number; start: number; end: number; title?: string; content: string }): Promise<NoteDto> {
    return this.write((api) => api.saveNote(a));
  }

  deleteNote(id: number): Promise<boolean> {
    return this.write((api) => api.deleteNote(id));
  }

  /** Idempotent (safe to retry across a leader handoff). */
  setBookmark(a: { start: number; end: number; on: boolean; moduleId?: number; title?: string }): Promise<BookmarkDto | null> {
    return this.write((api) => api.setBookmark(a));
  }
}
