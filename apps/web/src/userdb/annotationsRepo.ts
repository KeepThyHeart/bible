/**
 * Worker repo `annotations` (S2, design §4): a plain-DTO facade over markup, notes and collections, one round trip
 * per chapter. Whole-verse/passage only in M3. Read methods are named `get*`/`list*` (no `changed` event).
 * Data shapes match desktop: `user_text_markup` (hex colour, null text range), `user_note` (`verse_note`, html content,
 * one `annotation` verse link) and `pinned_item` rows in the default bookmarks collection (`isDefaultBookmarks`).
 *
 * The core repositories are async or sync as they were written, so every method here returns a Promise.
 * The model classes are not in the browser barrel, so new rows are passed as plain objects (the repos read fields
 * only); an existing note comes from the repo itself. Retries on a leader handoff are safe: `setHighlight` replaces
 * same-range markup and `setBookmark(on)` is idempotent (`toggleBookmark` is kept for callers that cannot retry).
 * No side effects at module load.
 */
import { UserRepositories, getBookName, normalizeMarkupColor, type Sync } from '@bible/core/browser';

export interface HighlightDto { id: number; moduleId: number; start: number; end: number; color: string /* #RRGGBB */ }
export interface NoteDto { id: number; start: number; end: number; title: string | null; content: string; modified: string }
export interface BookmarkDto { id: number; start: number; end: number; title: string | null }
export interface ChapterAnnotations { highlights: HighlightDto[]; notes: NoteDto[]; bookmarks: BookmarkDto[] }

export interface AnnotationsRepo {
  getChapter(moduleId: number, startVerseId: number, endVerseId: number): Promise<ChapterAnnotations>;
  /** Replaces markup on the same range. Idempotent. */
  setHighlight(a: { moduleId: number; start: number; end: number; color: string }): Promise<HighlightDto>;
  removeHighlight(a: { moduleId: number; start: number; end: number }): Promise<number>;
  /** Creates the note's verse link via the repo. Without `id` a new note is made. */
  saveNote(a: { id?: number; start: number; end: number; title?: string; content: string }): Promise<NoteDto>;
  deleteNote(id: number): Promise<boolean>;
  /** In the default collection (`isDefaultBookmarks`). Not idempotent under retries: prefer `setBookmark`. */
  toggleBookmark(a: { start: number; end: number; moduleId?: number; title?: string }): Promise<BookmarkDto | null>;
  /** Idempotent: `on` guarantees exactly one bookmark with this exact range, `off` none. Returns it, or null when off. */
  setBookmark(a: { start: number; end: number; on: boolean; moduleId?: number; title?: string }): Promise<BookmarkDto | null>;
  listNotes(limit?: number): Promise<NoteDto[]>;
  listBookmarks(): Promise<BookmarkDto[]>;
}

interface MarkupLike { markupId?: number; moduleId: number; verseIdStart: number; verseIdEnd?: number | null; textStart?: number | null; color: string }
interface NoteLike { noteId?: number; verseIdStart?: number; verseIdEnd?: number | null; title?: string; content: string; modifiedDate?: string; noteType: string }
interface PinLike { pinId?: number; verseIdStart?: number; verseIdEnd?: number | null; title?: string }

const endOf = (start: number, end: number | null | undefined): number => end ?? start;
const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number): boolean => aStart <= bEnd && aEnd >= bStart;

function toHighlight(m: MarkupLike): HighlightDto {
  return { id: m.markupId!, moduleId: m.moduleId, start: m.verseIdStart, end: endOf(m.verseIdStart, m.verseIdEnd), color: normalizeMarkupColor(m.color) };
}
function toNote(n: NoteLike): NoteDto {
  const start = n.verseIdStart!;
  return { id: n.noteId!, start, end: endOf(start, n.verseIdEnd), title: n.title ?? null, content: n.content, modified: n.modifiedDate ?? '' };
}
function toBookmark(p: PinLike): BookmarkDto {
  const start = p.verseIdStart!;
  return { id: p.pinId!, start, end: endOf(start, p.verseIdEnd), title: p.title ?? null };
}

export function createAnnotationsRepo(sql: Sync.ISql): AnnotationsRepo {
  const markup = new UserRepositories.UserTextMarkupRepository(sql);
  const notes = new UserRepositories.UserNoteRepository(sql);
  const collections = new UserRepositories.CollectionRepository(sql);
  // Reference text only: the main thread passes its localised reference as `title`.
  const bookNames = { getByBookNumber: (n: number) => ({ bookName: getBookName(n) }) };
  const service = new UserRepositories.CollectionService(collections, bookNames as never);

  const wholeVerse = (m: MarkupLike): boolean => m.textStart == null;
  const sameRange = (start: number, end: number) => (m: { verseIdStart?: number; verseIdEnd?: number | null }): boolean =>
    m.verseIdStart === start && endOf(start, m.verseIdEnd) === end;

  const bookmarks = (): PinLike[] => service.getBookmarks() as unknown as PinLike[];

  async function sameRangeMarkup(moduleId: number, start: number, end: number): Promise<MarkupLike[]> {
    const rows = (await markup.getForVerseRange(start, end, moduleId)) as unknown as MarkupLike[];
    return rows.filter((m) => wholeVerse(m) && sameRange(start, end)(m));
  }

  const api: AnnotationsRepo = {
    async getChapter(moduleId, startVerseId, endVerseId) {
      const marks = (await markup.getForVerseRange(startVerseId, endVerseId, moduleId)) as unknown as MarkupLike[];
      const ns = (notes.getForVerseRange(startVerseId, endVerseId) as unknown as NoteLike[]).filter(
        (n) => n.noteType === 'verse_note' && n.verseIdStart != null,
      );
      return {
        highlights: marks.filter(wholeVerse).map(toHighlight),
        notes: ns.map(toNote),
        bookmarks: bookmarks()
          .filter((p) => p.verseIdStart != null && overlaps(p.verseIdStart, endOf(p.verseIdStart, p.verseIdEnd), startVerseId, endVerseId))
          .map(toBookmark),
      };
    },

    async setHighlight({ moduleId, start, end, color }) {
      const old = await sameRangeMarkup(moduleId, start, end);
      const row = { moduleId, verseIdStart: start, verseIdEnd: end, color: normalizeMarkupColor(color), metadata: { markupType: 'highlight' } };
      const created = (await markup.create(row as never)) as unknown as MarkupLike;
      for (const m of old) await markup.delete(m.markupId!);
      return toHighlight(created);
    },

    async removeHighlight({ moduleId, start, end }) {
      const old = await sameRangeMarkup(moduleId, start, end);
      for (const m of old) await markup.delete(m.markupId!);
      return old.length;
    },

    async saveNote({ id, start, end, title, content }) {
      const cleanTitle = title?.trim() || undefined;
      const link = { verseIdStart: start, verseIdEnd: end, linkType: 'annotation' as const };
      if (id !== undefined) {
        const existing = notes.getById(id);
        if (!existing) throw new Error('Note not found');
        existing.title = cleanTitle;
        existing.content = content;
        existing.verseIdStart = start;
        existing.verseIdEnd = end;
        existing.setLinkedVerses([{ noteId: id, ...link }]);
        return toNote(notes.update(existing) as unknown as NoteLike);
      }
      const now = new Date().toISOString();
      const links = [{ noteId: 0, ...link }]; // the repo writes the link under the id it just assigned
      const row = {
        verseIdStart: start, verseIdEnd: end, title: cleanTitle, content, contentFormat: 'html', noteType: 'verse_note',
        visibility: 'private', tags: [], createdDate: now, modifiedDate: now,
        getLinkedVerses: () => links, touch: () => undefined,
      };
      return toNote(notes.create(row as never) as unknown as NoteLike);
    },

    async deleteNote(id) {
      return notes.delete(id);
    },

    async setBookmark({ start, end, on, moduleId, title }) {
      const exact = bookmarks().filter(sameRange(start, end));
      const cleanTitle = title?.trim() || undefined;
      if (!on) {
        for (const p of exact) collections.deletePinnedItem(p.pinId!);
        return null;
      }
      if (exact.length > 0) {
        const [keep, ...dupes] = exact;
        for (const p of dupes) collections.deletePinnedItem(p.pinId!);
        return toBookmark(keep);
      }
      const pinId = end === start
        ? await service.quickBookmarkVerse(start, moduleId, cleanTitle)
        : await service.quickBookmarkPassage(start, end, moduleId, cleanTitle);
      return toBookmark(collections.getPinnedItem(pinId) as unknown as PinLike);
    },

    async toggleBookmark(a) {
      const has = bookmarks().some(sameRange(a.start, a.end));
      return api.setBookmark({ ...a, on: !has });
    },

    async listNotes(limit) {
      const all = (notes.getByType('verse_note') as unknown as NoteLike[]).filter((n) => n.verseIdStart != null);
      return (limit === undefined ? all : all.slice(0, Math.max(0, limit))).map(toNote);
    },

    async listBookmarks() {
      return bookmarks().filter((p) => p.verseIdStart != null).map(toBookmark);
    },
  };
  return api;
}
