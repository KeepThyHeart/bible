/**
 * What a chapter change actually costs the Commentary pane.
 *
 * Three things used to be spent on every navigation regardless of whether a
 * Commentary view was on screen — only one right-hand pane is mounted at a time
 * (`DesktopApp`), and the mobile nav shows one view at a time:
 *
 *   1. one full-chapter request per open tab;
 *   2. a `chapter-verses` request per active module, deriving from the server
 *      something the chapter overview already answers for every module;
 *   3. the chapter overview itself.
 *
 * These tests pin the replacement: nothing until a view is mounted, then the
 * visible tab on its own and the rest in one batch, with `chapter-verses`
 * computed from the overview rather than fetched.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ICommentaryDataProvider } from '../providers/interfaces';
import { commentaryStore, HOME_TAB_ID } from './commentaryStore';

const getCommentary = vi.fn();
const getAllCommentary = vi.fn();
const getChapterOverview = vi.fn();
const getChapterVerses = vi.fn();

/**
 * John 3 as the overview reports it: `startVerse`/`endVerse` are verse
 * *numbers*, which is exactly what `chapter-verses` used to return.
 */
const JOHN_3_OVERVIEW = {
  book: 43,
  chapter: 3,
  modules: [['Barnes', 'Barnes'], ['Geneva', 'Geneva']] as [string, string][],
  entries: [
    { moduleIdx: 0, startVerse: 1, endVerse: 1, level: 'v', wordCount: 100 },
    { moduleIdx: 1, startVerse: 16, endVerse: 18, level: 'p', wordCount: 200 },
    { moduleIdx: 1, startVerse: 3, endVerse: 3, level: 'v', wordCount: 50 },
    // Chapter-level: covers the chapter, no particular verse. The endpoint
    // skipped these and so must the derivation.
    { moduleIdx: 1, startVerse: 0, endVerse: 0, level: 'c', wordCount: 10 },
  ],
};

/**
 * `provider` is private, and these tests want it without `init()`'s session
 * restore and tab seeding — so the modifier has to be stepped past.
 */
function setProvider(): void {
  (commentaryStore as unknown as { provider: ICommentaryDataProvider }).provider = {
    getCommentary,
    getAllCommentary,
    getChapterOverview,
    getChapterVerses,
  } as unknown as ICommentaryDataProvider;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

function resetStore(): void {
  setProvider();
  commentaryStore.tabs = [
    { id: HOME_TAB_ID, moduleAbbr: '__home__', moduleName: 'Overview' },
    { id: 'ctab-1', moduleAbbr: 'Barnes', moduleName: 'Barnes' },
    { id: 'ctab-2', moduleAbbr: 'Geneva', moduleName: 'Geneva' },
    { id: 'ctab-3', moduleAbbr: 'Clarke', moduleName: 'Clarke' },
  ];
  commentaryStore.activeTabId = 'ctab-1';
  commentaryStore.entries = [];
  commentaryStore.entriesByTab.clear();
  commentaryStore.chapterVersesCache.clear();
  commentaryStore.chapterOverviewCache.clear();
  commentaryStore.syncedBook = null;
  commentaryStore.syncedChapter = null;
  const internals = commentaryStore as unknown as {
    _inFlightByModule: Map<string, number>;
    _chapterLoadsInFlight: Set<string>;
    _chapterOverviewKey: string;
    _viewMounted: boolean;
  };
  internals._inFlightByModule.clear();
  internals._chapterLoadsInFlight.clear();
  internals._chapterOverviewKey = '';
  internals._viewMounted = false;
}

describe('commentaryStore chapter requests', () => {
  beforeEach(() => {
    getCommentary.mockReset().mockResolvedValue({ entries: [] });
    getAllCommentary.mockReset().mockResolvedValue({ modules: {} });
    getChapterOverview.mockReset().mockResolvedValue(JOHN_3_OVERVIEW);
    getChapterVerses.mockReset().mockResolvedValue({ verses: [] });
    resetStore();
  });

  it('requests nothing while no Commentary view is on screen', async () => {
    await commentaryStore.loadForChapter(43, 3);
    await flush();

    expect(getCommentary).not.toHaveBeenCalled();
    expect(getAllCommentary).not.toHaveBeenCalled();
    expect(getChapterOverview).not.toHaveBeenCalled();
  });

  it('loads the chapter when a view mounts after the navigation', async () => {
    await commentaryStore.loadForChapter(43, 3);
    await flush();
    commentaryStore.viewMounted(true);
    await flush();

    // Switching to the Commentary tab must not leave the pane empty just
    // because the chapter changed while it was hidden.
    expect(getCommentary).toHaveBeenCalledWith('Barnes', 43, 3);
  });

  it('fetches the visible tab alone and the rest in one batch', async () => {
    commentaryStore.viewMounted(true);
    await commentaryStore.loadForChapter(43, 3);
    await flush();

    // The tab on screen answers as fast as it can, never behind a background
    // module that may be an order of magnitude larger.
    expect(getCommentary).toHaveBeenCalledTimes(1);
    expect(getCommentary).toHaveBeenCalledWith('Barnes', 43, 3);

    // The two behind it cost one request between them, not one each.
    expect(getAllCommentary).toHaveBeenCalledTimes(1);
    expect(getAllCommentary).toHaveBeenCalledWith(43, 3, ['Geneva', 'Clarke']);
  });

  it('caches an empty result for a module the batch had nothing for', async () => {
    getAllCommentary.mockResolvedValue({ modules: { Geneva: { entries: [{ verse_id_start: 43003016 }] } } });
    commentaryStore.viewMounted(true);
    await commentaryStore.loadForChapter(43, 3);
    await flush();

    expect(commentaryStore.entriesByTab.get('Geneva')).toHaveLength(1);
    // Clarke is absent from the response because it has nothing here. Caching
    // that is what stops the next verse click asking for it again.
    expect(commentaryStore.entriesByTab.get('Clarke')).toEqual([]);
  });

  it('does not let a request for the previous chapter suppress the new one', async () => {
    commentaryStore.viewMounted(true);
    // Never resolves: the John 3 requests are still out when John 4 starts.
    getCommentary.mockReturnValue(new Promise(() => {}));
    getAllCommentary.mockReturnValue(new Promise(() => {}));

    await commentaryStore.loadForChapter(43, 3);
    await commentaryStore.loadForChapter(43, 4);
    await flush();

    expect(getCommentary).toHaveBeenCalledWith('Barnes', 43, 4);
    expect(getAllCommentary).toHaveBeenCalledWith(43, 4, ['Geneva', 'Clarke']);
  });

  it('derives chapter verses from the overview instead of asking the server', async () => {
    commentaryStore.viewMounted(true);
    await commentaryStore.loadForChapter(43, 3);
    await flush();

    await commentaryStore.loadChapterVerses('Geneva', 43, 3);

    expect(getChapterVerses).not.toHaveBeenCalled();
    // Verse 3, plus the whole 16–18 passage range. The chapter-level entry
    // covers no particular verse and contributes nothing.
    expect(commentaryStore.chapterVersesCache.get('Geneva')).toEqual([3, 16, 17, 18]);
  });

  it('fetches the overview only once per chapter, however many tabs ask', async () => {
    commentaryStore.viewMounted(true);
    await commentaryStore.loadForChapter(43, 3);
    await flush();

    await commentaryStore.loadChapterVerses('Barnes', 43, 3);
    await commentaryStore.loadChapterVerses('Geneva', 43, 3);

    expect(getChapterOverview).toHaveBeenCalledTimes(1);
    expect(commentaryStore.chapterVersesCache.get('Barnes')).toEqual([1]);
  });
});
