import { describe, it, expect, vi } from 'vitest';
import { compilePassageNotes, MAX_COMPILE_VERSES, type CompileDeps, type CompileOptions } from './compilePassageNotes';
import type { PassageSpec } from './parsePassageList';
import type { CachedVerse } from '../verseFetchCache';

const BOOKS: Record<number, string> = { 45: 'Romans', 23: 'Isaiah' };
const verse = (book: number, chapter: number, v: number): CachedVerse => ({
  verse_id: book * 1_000_000 + chapter * 1000 + v,
  book_number: book,
  chapter,
  verse: v,
  text: `text ${chapter}:${v}`,
});
const range = (book: number, ch: number, from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => verse(book, ch, from + i));

const spec = (label: string, book: number, startId: number, endId: number): PassageSpec => ({ label, book, startId, endId, source: label });

const OPTS: CompileOptions = {
  canonicalOrder: false,
  includeVerseText: true,
  translation: 'KJV',
  redLetters: false,
  versesWithoutNotes: 'skip',
  blankLines: 3,
  passageHeadings: true,
  showTranslation: false,
  verseLabel: 'reference',
};

interface Rec { bookName: string; chapter: number; verse: number; note: { content: unknown } }
const rec = (bookName: string, chapter: number, v: number, content: unknown): Rec => ({ bookName, chapter, verse: v, note: { content } });

function deps(all: CachedVerse[], notes: Rec[] = []) {
  const getVerses = vi.fn(async (_tr: string, s: number, e: number) => all.filter((v) => v.verse_id >= s && v.verse_id <= e));
  const readVerseNotes = vi.fn(async () => notes);
  const d: CompileDeps = {
    getVerses,
    readVerseNotes,
    folderName: (b) => BOOKS[b],
    bookName: (b) => BOOKS[b],
  };
  return { d, getVerses, readVerseNotes };
}

const rom = [...range(45, 7, 24, 25), ...range(45, 8, 1, 4)];
const romSpec = spec('Romans 7:24-8:4', 45, 45007024, 45008004);

describe('compilePassageNotes', () => {
  it('reads notes once, with split queries for a cross-chapter passage', async () => {
    const { d, readVerseNotes } = deps(rom, [rec('Romans', 8, 1, '<p>No condemnation</p>')]);
    const r = await compilePassageNotes([romSpec], OPTS, d);
    expect(readVerseNotes).toHaveBeenCalledTimes(1);
    expect(readVerseNotes).toHaveBeenCalledWith([
      { bookName: 'Romans', chapter: 7, fromVerse: 24, toVerse: 25 },
      { bookName: 'Romans', chapter: 8, fromVerse: 1, toVerse: 4 },
    ]);
    expect(r).toMatchObject({ ok: true, verseCount: 6, noteCount: 1 });
  });

  it('skip mode: heading, verse text with reference, note; escapes the heading', async () => {
    const { d } = deps(rom, [rec('Romans', 8, 1, '<p>Note A</p>')]);
    const r = await compilePassageNotes([{ ...romSpec, label: 'A <b> & B' }], OPTS, d);
    if (!r.ok) throw new Error('expected ok');
    expect(r.html).toContain('<h2>A &lt;b&gt; &amp; B</h2>');
    expect(r.html).toContain('Note A');
    expect(r.html).toContain('text 8:1');
    expect(r.html).toContain('Romans 8:1');
    expect(r.html).not.toContain('text 8:2');
    expect(r.html.indexOf('text 8:1')).toBeLessThan(r.html.indexOf('Note A'));
  });

  it('blank-space mode adds blankLines paragraphs after unnoted verses', async () => {
    const { d } = deps(range(45, 8, 1, 2), [rec('Romans', 8, 1, '<p>N</p>')]);
    const r = await compilePassageNotes([spec('R', 45, 45008001, 45008002)], { ...OPTS, versesWithoutNotes: 'blank-space' }, d);
    if (!r.ok) throw new Error('expected ok');
    expect(r.html.match(/<p>&nbsp;<\/p>/g)).toHaveLength(3);
    expect(r.html).toContain('text 8:2');
  });

  it('text-only mode keeps unnoted verse text with no blanks', async () => {
    const { d } = deps(range(45, 8, 1, 2), [rec('Romans', 8, 1, '<p>N</p>')]);
    const r = await compilePassageNotes([spec('R', 45, 45008001, 45008002)], { ...OPTS, versesWithoutNotes: 'text-only' }, d);
    if (!r.ok) throw new Error('expected ok');
    expect(r.html).toContain('text 8:2');
    expect(r.html).not.toContain('&nbsp;');
  });

  it('no verse text: label headings by option; text-only degrades to skip', async () => {
    const verses = range(45, 8, 1, 2);
    const notes = [rec('Romans', 8, 1, '<p>N</p>')];
    const s = spec('R', 45, 45008001, 45008002);
    const base = { ...OPTS, includeVerseText: false };
    const a = await compilePassageNotes([s], base, deps(verses, notes).d);
    if (!a.ok) throw new Error();
    expect(a.html).toContain('<h3>Romans 8:1</h3><p>N</p>');
    expect(a.html).not.toContain('8:2');
    const b = await compilePassageNotes([s], { ...base, verseLabel: 'number' }, deps(verses, notes).d);
    if (!b.ok) throw new Error();
    expect(b.html).toContain('<h3>8:1</h3>');
    const c = await compilePassageNotes([s], { ...base, verseLabel: 'none' }, deps(verses, notes).d);
    if (!c.ok) throw new Error();
    expect(c.html).not.toContain('<h3>');
    const e = await compilePassageNotes([s], { ...base, versesWithoutNotes: 'text-only' }, deps(verses, notes).d);
    if (!e.ok) throw new Error();
    expect(e.html).not.toContain('8:2');
  });

  it('verse label "number" and "none" with text', async () => {
    const notes = [rec('Romans', 8, 1, '<p>N</p>')];
    const s = spec('R', 45, 45008001, 45008001);
    const num = await compilePassageNotes([s], { ...OPTS, verseLabel: 'number' }, deps(range(45, 8, 1, 1), notes).d);
    const none = await compilePassageNotes([s], { ...OPTS, verseLabel: 'none' }, deps(range(45, 8, 1, 1), notes).d);
    if (!num.ok || !none.ok) throw new Error();
    expect(num.html).not.toContain('Romans 8:1');
    expect(num.html).toMatch(/\(?1\)?/);
    expect(none.html).not.toContain('Romans 8:1');
    expect(none.html).toContain('text 8:1');
  });

  it('headings off, translation shown', async () => {
    const notes = [rec('Romans', 8, 1, '<p>N</p>')];
    const s = spec('Rom', 45, 45008001, 45008001);
    const off = await compilePassageNotes([s], { ...OPTS, passageHeadings: false }, deps(range(45, 8, 1, 1), notes).d);
    const tr = await compilePassageNotes([s], { ...OPTS, showTranslation: true }, deps(range(45, 8, 1, 1), notes).d);
    if (!off.ok || !tr.ok) throw new Error();
    expect(off.html).not.toContain('<h2>');
    expect(tr.html).toContain('<h2>Rom (KJV)</h2>');
  });

  it('refuses over the limit before any note read', async () => {
    const many = Array.from({ length: MAX_COMPILE_VERSES + 1 }, (_, i) => verse(45, 1 + Math.floor(i / 100), (i % 100) + 1));
    const { d, readVerseNotes } = deps(many);
    const r = await compilePassageNotes([spec('big', 45, 45001001, 45999999)], OPTS, d);
    expect(r).toEqual({ ok: false, reason: 'too-many-verses', verseCount: MAX_COMPILE_VERSES + 1 });
    expect(readVerseNotes).not.toHaveBeenCalled();
  });

  it('stops fetching passages once the running total is over the limit', async () => {
    const many = Array.from({ length: MAX_COMPILE_VERSES + 1 }, (_, i) => verse(45, 1 + Math.floor(i / 100), (i % 100) + 1));
    const { d } = deps(many);
    const getVerses = vi.fn(d.getVerses);
    const r = await compilePassageNotes(
      [spec('a', 45, 45001001, 45999999), spec('b', 45, 45001001, 45001005), spec('c', 45, 45001001, 45001005)],
      OPTS,
      { ...d, getVerses },
    );
    expect(r).toEqual({ ok: false, reason: 'too-many-verses', verseCount: MAX_COMPILE_VERSES + 1 });
    expect(getVerses).toHaveBeenCalledTimes(1);
  });

  it('exactly the limit is allowed', async () => {
    const many = Array.from({ length: MAX_COMPILE_VERSES }, (_, i) => verse(45, 1 + Math.floor(i / 100), (i % 100) + 1));
    const r = await compilePassageNotes([spec('big', 45, 45001001, 45999999)], OPTS, deps(many).d);
    expect(r).toMatchObject({ ok: false, reason: 'no-notes' });
  });

  it('empty list, nothing fetched', async () => {
    expect(await compilePassageNotes([], OPTS, deps([]).d)).toEqual({ ok: false, reason: 'empty' });
    expect(await compilePassageNotes([romSpec], OPTS, deps([]).d)).toEqual({ ok: false, reason: 'not-found', verseCount: 0 });
  });

  it('drops empty passages and lists them; all empty gives no-notes', async () => {
    const all = [...range(45, 8, 1, 2), ...range(23, 53, 1, 2)];
    const notes = [rec('Isaiah', 53, 1, '<p>Who</p>')];
    const specs = [spec('Romans 8', 45, 45008001, 45008999), spec('Isaiah 53', 23, 23053001, 23053999)];
    const r = await compilePassageNotes(specs, OPTS, deps(all, notes).d);
    if (!r.ok) throw new Error();
    expect(r.emptyPassages).toEqual(['Romans 8']);
    expect(r.html).not.toContain('Romans 8</h2>');
    expect(await compilePassageNotes([specs[0]], OPTS, deps(all, notes).d)).toEqual({ ok: false, reason: 'no-notes', verseCount: 2 });
  });

  it('skips JSON content and sanitizes note HTML', async () => {
    const notes = [
      rec('Romans', 8, 1, { type: 'doc' }),
      rec('Romans', 8, 2, '<p>ok<script>alert(1)</script></p>'),
    ];
    const r = await compilePassageNotes([spec('R', 45, 45008001, 45008002)], OPTS, deps(range(45, 8, 1, 2), notes).d);
    if (!r.ok) throw new Error();
    expect(r.noteCount).toBe(1);
    expect(r.html).toContain('ok');
    expect(r.html).not.toContain('script');
    expect(r.html).not.toContain('text 8:1');
  });
});
