// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { createUserDbHandler } from './handler';
import { finishOpen } from './openUserDb';
import type { UserDbEvent } from './protocol';
import type { ChapterAnnotations, HighlightDto, NoteDto, BookmarkDto } from './annotationsRepo';

let sqlite3: Awaited<ReturnType<typeof sqlite3InitModule>>;
beforeAll(async () => {
  sqlite3 = await sqlite3InitModule();
}, 60_000);

const JOHN_3_16 = 43003016;
const JOHN_3_17 = 43003017;
const CH_START = 43003001;
const CH_END = 43003036;

function setup(db = new sqlite3.oo1.DB(':memory:')) {
  const events: UserDbEvent[] = [];
  const handler = createUserDbHandler({ open: async () => finishOpen(db, ':memory:'), emit: (e) => events.push(e) });
  const call = <T>(method: string, ...args: unknown[]) => handler.handle({ op: 'call', repo: 'annotations', method, args }) as Promise<T>;
  const chapter = (moduleId = 1) => call<ChapterAnnotations>('getChapter', moduleId, CH_START, CH_END);
  return { handler, events, call, chapter, db };
}

describe('annotations repo', () => {
  it('highlights: set replaces same-range markup, normalises colour, filters by module', async () => {
    const { call, chapter, events } = setup();
    const a = await call<HighlightDto>('setHighlight', { moduleId: 1, start: JOHN_3_16, end: JOHN_3_16, color: 'yellow' });
    expect(a).toMatchObject({ moduleId: 1, start: JOHN_3_16, end: JOHN_3_16, color: '#FFF3A3' });
    const b = await call<HighlightDto>('setHighlight', { moduleId: 1, start: JOHN_3_16, end: JOHN_3_16, color: '#b7e4c7' });
    expect(b.color).toBe('#B7E4C7');
    expect(b.id).not.toBe(a.id);
    expect((await chapter(1)).highlights).toEqual([b]);
    expect((await chapter(2)).highlights).toEqual([]); // other module
    expect(events.some((e) => e.event === 'changed' && e.tables.includes('user_text_markup'))).toBe(true);
    expect(await call<number>('removeHighlight', { moduleId: 1, start: JOHN_3_16, end: JOHN_3_16 })).toBe(1);
    expect(await call<number>('removeHighlight', { moduleId: 1, start: JOHN_3_16, end: JOHN_3_16 })).toBe(0);
    expect((await chapter(1)).highlights).toEqual([]);
  }, 60_000);

  it('notes: create, edit, delete; module-independent; link written', async () => {
    const { call, chapter, db } = setup();
    const n = await call<NoteDto>('saveNote', { start: JOHN_3_16, end: JOHN_3_16, title: ' Love ', content: '<p>God so loved</p>' });
    expect(n).toMatchObject({ start: JOHN_3_16, end: JOHN_3_16, title: 'Love', content: '<p>God so loved</p>' });
    const links = db.selectObjects('SELECT source_type, source_id, verse_id_start, link_type FROM verse_link');
    expect(links).toEqual([{ source_type: 'note', source_id: n.id, verse_id_start: JOHN_3_16, link_type: 'annotation' }]);
    const edited = await call<NoteDto>('saveNote', { id: n.id, start: JOHN_3_16, end: JOHN_3_17, content: 'changed' });
    expect(edited).toMatchObject({ id: n.id, end: JOHN_3_17, title: null, content: 'changed' });
    expect((await chapter(1)).notes).toEqual([edited]);
    expect((await chapter(99)).notes).toEqual([edited]);
    expect(await call<NoteDto[]>('listNotes')).toHaveLength(1);
    expect(await call<boolean>('deleteNote', n.id)).toBe(true);
    expect((await chapter(1)).notes).toEqual([]);
    expect(await call<NoteDto[]>('listNotes')).toEqual([]);
  }, 60_000);

  it('bookmarks: default collection, idempotent setBookmark, toggle', async () => {
    const { call, chapter, db } = setup();
    expect(await call<BookmarkDto[]>('listBookmarks')).toEqual([]);
    expect(db.selectValue('SELECT COUNT(*) FROM collection')).toBe(0); // reads create nothing
    const a = await call<BookmarkDto>('setBookmark', { start: JOHN_3_16, end: JOHN_3_16, on: true, moduleId: 1, title: 'John 3:16' });
    const again = await call<BookmarkDto>('setBookmark', { start: JOHN_3_16, end: JOHN_3_16, on: true, moduleId: 1 });
    expect(again.id).toBe(a.id);
    expect(db.selectValue('SELECT COUNT(*) FROM pinned_item')).toBe(1);
    expect(db.selectValue('SELECT COUNT(*) FROM collection')).toBe(1);
    expect(db.selectValue("SELECT metadata FROM collection")).toContain('isDefaultBookmarks');
    expect((await chapter()).bookmarks).toEqual([{ id: a.id, start: JOHN_3_16, end: JOHN_3_16, title: 'John 3:16' }]);
    const passage = await call<BookmarkDto>('setBookmark', { start: JOHN_3_16, end: JOHN_3_17, on: true });
    expect(passage.end).toBe(JOHN_3_17);
    expect((await chapter()).bookmarks).toHaveLength(2);
    expect(await call('setBookmark', { start: JOHN_3_16, end: JOHN_3_16, on: false })).toBeNull();
    expect(await call('setBookmark', { start: JOHN_3_16, end: JOHN_3_16, on: false })).toBeNull();
    expect((await chapter()).bookmarks.map((b) => b.id)).toEqual([passage.id]);
    const t = await call<BookmarkDto | null>('toggleBookmark', { start: JOHN_3_17, end: JOHN_3_17 });
    expect(t?.start).toBe(JOHN_3_17);
    expect(await call('toggleBookmark', { start: JOHN_3_17, end: JOHN_3_17 })).toBeNull();
    expect(db.selectValue('SELECT COUNT(*) FROM collection')).toBe(1);
  }, 60_000);

  it('survives a reopen of the same database', async () => {
    const first = setup();
    await first.call('setHighlight', { moduleId: 1, start: JOHN_3_16, end: JOHN_3_16, color: 'blue' });
    await first.call('saveNote', { start: JOHN_3_16, end: JOHN_3_16, content: 'n' });
    await first.call('setBookmark', { start: JOHN_3_16, end: JOHN_3_16, on: true });
    const second = setup(first.db);
    const c = await second.chapter();
    expect(c.highlights).toHaveLength(1);
    expect(c.notes).toHaveLength(1);
    expect(c.bookmarks).toHaveLength(1);
  }, 60_000);
});
