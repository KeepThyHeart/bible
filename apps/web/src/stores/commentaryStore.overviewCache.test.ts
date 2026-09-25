/**
 * Combined Summary (and every other Overview accordion) showed the wrong passage.
 *
 * Repro: at John 3:16 expand Combined Summary — correct. Go to Genesis 3:15 and
 * expand it — John's notes. "Add to tabs" then said "no commentary for this
 * verse".
 *
 * Root cause: `entriesByTab` is keyed by module alone. A module with a tab has
 * its entry dropped on every chapter change, but the Overview opens modules that
 * have NO tab (Combined Summary is one until "Add to tabs"), and the chapter
 * change never cleared those. `fetchModuleEntries` then served the leftover as
 * the new chapter's answer ("cached"), the accordion's "no verse matched, show
 * everything" fallback put John's first entry on screen under Genesis, and
 * `addTab` painted the same stale array into the new tab.
 *
 * A one-verse seed had the same flaw within a chapter: expanding a module at
 * verse 16 and again at verse 17 served verse 16's seed.
 */
import type { ICommentaryDataProvider } from '../providers/interfaces';
import type { CommentaryEntryData } from '../types';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { commentaryStore, HOME_TAB_ID } from './commentaryStore';

const JOHN_3_16 = 43003016;
const JOHN_3_17 = 43003017;
const GEN_3_15 = 1003015;

function entryFor(verseId: number, content = `notes for ${verseId}`): CommentaryEntryData {
  return {
    entry_id: verseId,
    verse_id_start: verseId,
    verse_id_end: verseId,
    entry_level: 'verse',
    content,
    word_count: 1,
  };
}

/** Per-verse endpoint: answers with that verse's own entry. */
function stubVerseEndpoint() {
  return vi.fn(async (url: string) => {
    const verseId = Number(url.split('/verse/')[1]);
    return { ok: true, json: async () => ({ entries: [entryFor(verseId)] }) } as Response;
  });
}

function setProvider(stub: Partial<ICommentaryDataProvider>): void {
  (commentaryStore as unknown as { provider: ICommentaryDataProvider }).provider =
    stub as ICommentaryDataProvider;
}

const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));

describe('commentaryStore Overview accordion cache', () => {
  let fetchMock: ReturnType<typeof stubVerseEndpoint>;
  let getCommentary: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = stubVerseEndpoint();
    vi.stubGlobal('fetch', fetchMock);
    getCommentary = vi.fn(async (_abbr: string, book: number, chapter: number) => ({
      entries: [entryFor(book * 1000000 + chapter * 1000 + 1, `chapter ${book}:${chapter}`)],
    }));
    setProvider({
      getCommentary: getCommentary as unknown as ICommentaryDataProvider['getCommentary'],
      getAllCommentary: vi.fn(async () => ({ modules: {} })) as never,
    });

    // Combined Summary is deliberately NOT a tab, like a fresh Overview.
    commentaryStore.tabs = [{ id: HOME_TAB_ID, moduleAbbr: '__home__', moduleName: 'Overview' }];
    commentaryStore.activeTabId = HOME_TAB_ID;
    commentaryStore.entries = [];
    commentaryStore.entriesByTab.clear();
    (commentaryStore as unknown as { entriesScope?: Map<string, unknown> }).entriesScope?.clear();
    commentaryStore.chapterOverviewCache.clear();
    commentaryStore.syncedBook = 43;
    commentaryStore.syncedChapter = 3;
    commentaryStore.viewMounted(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('serves the new chapter’s entries after navigating away (the reported repro)', async () => {
    const atJohn = await commentaryStore.fetchModuleEntries('SYNTHESIS', 43, 3, JOHN_3_16);
    expect(atJohn.map(e => e.verse_id_start)).toEqual([JOHN_3_16]);

    await commentaryStore.loadForChapter(1, 3);
    const atGenesis = await commentaryStore.fetchModuleEntries('SYNTHESIS', 1, 3, GEN_3_15);

    expect(atGenesis.map(e => e.verse_id_start)).toEqual([GEN_3_15]);
  });

  it('does not paint John’s notes into a tab added from the Overview at Genesis', async () => {
    await commentaryStore.fetchModuleEntries('SYNTHESIS', 43, 3, JOHN_3_16);
    await commentaryStore.loadForChapter(1, 3);
    await commentaryStore.fetchModuleEntries('SYNTHESIS', 1, 3, GEN_3_15);

    commentaryStore.addTab('SYNTHESIS', 'Combined Summary', GEN_3_15);
    await flush();

    const passages = commentaryStore.entries.map(e => Math.floor(e.verse_id_start / 1000));
    expect(passages.length).toBeGreaterThan(0);
    expect(passages.every(p => p === 1003)).toBe(true);
  });

  it('does not serve one verse’s seed for another verse of the same chapter', async () => {
    await commentaryStore.fetchModuleEntries('SYNTHESIS', 43, 3, JOHN_3_16);
    const next = await commentaryStore.fetchModuleEntries('SYNTHESIS', 43, 3, JOHN_3_17);

    expect(next.map(e => e.verse_id_start)).toEqual([JOHN_3_17]);
  });

  it('still reuses the cache for the same passage', async () => {
    await commentaryStore.fetchModuleEntries('SYNTHESIS', 43, 3, JOHN_3_16);
    fetchMock.mockClear();

    const again = await commentaryStore.fetchModuleEntries('SYNTHESIS', 43, 3, JOHN_3_16);

    expect(again.map(e => e.verse_id_start)).toEqual([JOHN_3_16]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not file a warm-up response under a chapter the reader has left', async () => {
    // Combined Summary is small enough to warm, so the accordion also asks for
    // the whole chapter in the background.
    commentaryStore.chapterOverviewCache.set('43-3', {
      modules: [['SYNTHESIS', 'Combined Summary']],
      entries: [{ moduleIdx: 0, startVerse: 16, endVerse: 16, level: 'v', wordCount: 10 }],
    } as never);
    let land!: (v: { entries: CommentaryEntryData[] }) => void;
    getCommentary.mockImplementationOnce(() => new Promise(res => { land = res as never; }));

    await commentaryStore.fetchModuleEntries('SYNTHESIS', 43, 3, JOHN_3_16);
    await commentaryStore.loadForChapter(1, 3);
    land({ entries: [entryFor(43003001, 'JOHN LATE')] });
    await flush();

    const atGenesis = await commentaryStore.fetchModuleEntries('SYNTHESIS', 1, 3, GEN_3_15);
    expect(atGenesis.map(e => e.verse_id_start)).toEqual([GEN_3_15]);
  });

  it('answers a pinned Overview’s other chapter without disturbing the shared cache', async () => {
    // Bible pane has moved on to John 3; the pinned Overview is still on Genesis 3.
    const atGenesis = await commentaryStore.fetchModuleEntries('SYNTHESIS', 1, 3, GEN_3_15);
    expect(atGenesis.map(e => e.verse_id_start)).toEqual([GEN_3_15]);

    expect(commentaryStore.entriesByTab.has('SYNTHESIS')).toBe(false);
  });
});
