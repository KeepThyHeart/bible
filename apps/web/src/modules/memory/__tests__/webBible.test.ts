import { describe, it, expect, vi } from 'vitest';
import { ReferenceParser } from '@bible/core/browser';
import { createWebBible, MAX_RANGE_VERSES, type WebBibleDeps } from '../webBible';

function deps(over: Partial<WebBibleDeps> = {}): WebBibleDeps {
  return {
    getTexts: async (_m, ids) => Object.fromEntries(ids.map((id) => [String(id), { verse_id: id, text: `t${id}` }])),
    modules: () => [{ abbreviation: 'KJV', name: 'King James', language_code: 'en' }],
    bookName: (b) => (b === 43 ? 'John' : `Book ${b}`),
    chapterCount: (b) => (b === 43 ? 21 : 1),
    testament: (b) => (b <= 39 ? 'old' : 'new'),
    parser: () => new ReferenceParser(),
    navigate: async () => undefined,
    defaultModule: () => 'KJV',
    ...over,
  };
}

describe('webBible (memory.bible)', () => {
  it('getRange spans chapters in canonical order, uses the named module and drops missing verses', async () => {
    const getTexts = vi.fn(deps().getTexts);
    const b = createWebBible(deps({ getTexts }));
    const v = await b.getRange(43003035, 43004002, { module: 'ASV' });
    expect(v.map((x) => x.verseId)).toEqual([43003035, 43003036, 43004001, 43004002]);
    expect(getTexts).toHaveBeenCalledWith('ASV', [43003035, 43003036, 43004001, 43004002]);
    const sparse = createWebBible(deps({ getTexts: async () => ({ '43003016': { verse_id: 43003016, text: 'x' } }) }));
    expect((await sparse.getRange(43003016, 43003017)).map((x) => x.verseId)).toEqual([43003016]);
  });

  it('getRange caps the range and handles start > end', async () => {
    const getTexts = vi.fn(deps().getTexts);
    const b = createWebBible(deps({ getTexts }));
    await b.getRange(19119001, 19150006);
    expect((getTexts.mock.calls[0]![1] as number[]).length).toBe(MAX_RANGE_VERSES);
    expect(await b.getRange(43003017, 43003016)).toEqual([]);
  });

  it('lists modules, 66 books and a chapter table from the KJV versification', async () => {
    const b = createWebBible(deps());
    expect(await b.listModules()).toEqual([{ id: 'KJV', abbreviation: 'KJV', name: 'King James', language: 'en' }]);
    const books = await b.listBooks();
    expect(books).toHaveLength(66);
    expect(books[42]).toMatchObject({ bookNumber: 43, name: 'John', testament: 'new', chapterCount: 21 });
    const chapters = await b.listChapters(43);
    expect(chapters).toHaveLength(21);
    expect(chapters[2]).toEqual({ bookNumber: 43, chapter: 3, verseCount: 36, firstVerseId: 43003001, lastVerseId: 43003036 });
  });

  it('parseReference returns verse ids for chapters, verses and ranges, and null for nonsense', async () => {
    const b = createWebBible(deps());
    expect(await b.parseReference('John 3:16')).toMatchObject({ bookNumber: 43, chapter: 3, startVerse: 16, startVerseId: 43003016 });
    expect(await b.parseReference('John 3:16-18')).toMatchObject({ startVerseId: 43003016, endVerse: 18, endVerseId: 43003018 });
    const whole = await b.parseReference('John 3');
    expect(whole).toMatchObject({ bookNumber: 43, chapter: 3 });
    expect(whole?.startVerse).toBeUndefined();
    expect(await b.parseReference('not a reference')).toBeNull();
  });

  it('navigateToVerse hands the id to the host', async () => {
    const navigate = vi.fn(async () => undefined);
    await createWebBible(deps({ navigate })).navigateToVerse(43003016);
    expect(navigate).toHaveBeenCalledWith(43003016);
  });
});
