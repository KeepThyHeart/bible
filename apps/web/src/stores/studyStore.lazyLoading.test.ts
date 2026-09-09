/**
 * The Study pane's data is loaded on demand, not on every verse selection.
 *
 * `useAppShared` emits a verse selection for verse 1 of every chapter the
 * reader lands on, and the store used to answer it by fetching cross-references,
 * topics, tag-graph entities and the chapter's interlinear rows — regardless of
 * whether the Study pane was the one on screen (only one right-hand pane is
 * mounted at a time) or whether the section that shows each was expanded
 * (`StudySection` renders no children while collapsed). A reader in the
 * Commentary pane paid four requests per chapter change and saw none of it.
 *
 * These tests pin the replacement: selection invalidates, `ensure*` fetches.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./bibleStore', () => ({
  bibleStore: {
    getActiveTab: () => ({ moduleAbbr: 'KJV', verses: [] }),
    fetchVerse: vi.fn().mockResolvedValue({ verse_id: 43003016, text_html: 'text' }),
  },
}));

import { studyStore } from './studyStore';
import type {
  ICrossRefDataProvider,
  IInterlinearDataProvider,
  IStudyOverviewProvider,
  ITagGraphDataProvider,
  ITopicalDataProvider,
} from '../providers/interfaces';

const getGroupsForVerse = vi.fn();
const getTopicsForVerse = vi.fn();
const getEntitiesForVerse = vi.fn();
const getInterlinear = vi.fn();
const loadOverviewChapter = vi.fn();

/**
 * A study-overview provider that never has a chapter — the default deployment,
 * since `data/cache/study-cache.db` is built by a generator that ships
 * separately. That is what puts the per-verse providers below on the hot path.
 */
const studyOverview: IStudyOverviewProvider = {
  loadChapter: (...args: [number, number]) => loadOverviewChapter(...args),
  hasChapter: () => false,
  isCacheAvailable: () => false,
  getCommentaryHomeForVerse: () => ({ verseModules: [], chapterModules: [] }),
  getTopicsForVerse: () => [],
  getCrossRefsForVerse: () => [],
  getEntitiesForVerse: () => [],
};

/** Wire the store up, optionally without a tag-graph provider. */
function init(options?: { tagGraph?: boolean }): void {
  studyStore.init({
    crossRef: { getGroupsForVerse, getEntryCount: vi.fn() } as unknown as ICrossRefDataProvider,
    topical: { getTopicsForVerse } as unknown as ITopicalDataProvider,
    tagGraph: options?.tagGraph === false
      ? undefined
      : ({ getEntitiesForVerse } as unknown as ITagGraphDataProvider),
    interlinear: { getInterlinear } as unknown as IInterlinearDataProvider,
    studyOverview,
  });
}

/** Let the ensure* chains (overview → per-verse provider) settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

function resetStore(): void {
  studyStore.pinned = false;
  studyStore.verseId = null;
  studyStore.book = null;
  studyStore.chapter = null;
  studyStore.crossRefGroups = [];
  studyStore.verseTopics = [];
  studyStore.verseEntities = [];
  studyStore.interlinearData = null;
  const internals = studyStore as unknown as Record<string, string>;
  internals.crossRefLoadedKey = '';
  internals.topicsLoadedKey = '';
  internals.interlinearLoadedKey = '';
  internals.crossRefInFlightKey = '';
  internals.topicsInFlightKey = '';
  internals.interlinearInFlightKey = '';
  internals.overviewLoadedChapter = '';
  internals.verseHtmlKey = '';
}

describe('studyStore lazy loading', () => {
  beforeEach(() => {
    getGroupsForVerse.mockReset().mockResolvedValue([]);
    getTopicsForVerse.mockReset().mockResolvedValue([]);
    getEntitiesForVerse.mockReset().mockResolvedValue([]);
    getInterlinear.mockReset().mockResolvedValue({ words: [], strongsEntries: {} });
    loadOverviewChapter.mockReset().mockResolvedValue(undefined);
    init();
    resetStore();
  });

  it('requests nothing when a verse is merely selected', async () => {
    studyStore.loadForVerse(43003016, 43, 3, 16);
    await flush();

    expect(getGroupsForVerse).not.toHaveBeenCalled();
    expect(getTopicsForVerse).not.toHaveBeenCalled();
    expect(getEntitiesForVerse).not.toHaveBeenCalled();
    expect(getInterlinear).not.toHaveBeenCalled();
    // Not even the chapter-level study overview, which is the request whose
    // answer would have made the three above unnecessary.
    expect(loadOverviewChapter).not.toHaveBeenCalled();
  });

  it('loads cross-references only once the section asks', async () => {
    studyStore.loadForVerse(43003016, 43, 3, 16);
    studyStore.ensureCrossRefs();
    await flush();

    expect(getGroupsForVerse).toHaveBeenCalledWith('TSKxref', 43003016);
    // Opening cross-references must not drag topics along behind it.
    expect(getTopicsForVerse).not.toHaveBeenCalled();
  });

  it('loads topics only once the section asks', async () => {
    studyStore.loadForVerse(43003016, 43, 3, 16);
    studyStore.ensureTopics();
    await flush();

    expect(getTopicsForVerse).toHaveBeenCalledWith(43003016);
    expect(getGroupsForVerse).not.toHaveBeenCalled();
  });

  it('loads the interlinear only once the section asks', async () => {
    studyStore.loadForVerse(43003016, 43, 3, 16);
    expect(getInterlinear).not.toHaveBeenCalled();

    studyStore.ensureInterlinear();
    await flush();
    expect(getInterlinear).toHaveBeenCalledWith(43, 3, 'KJV');
  });

  it('does not start a second request while one is already out', async () => {
    studyStore.loadForVerse(43003016, 43, 3, 16);
    // Two mounted consumers of the same state — the mobile pane renders the
    // topics list and the browser overlay from it.
    studyStore.ensureTopics();
    studyStore.ensureTopics();
    await flush();

    expect(getTopicsForVerse).toHaveBeenCalledTimes(1);
  });

  it('serves a re-asked section from what it already has', async () => {
    studyStore.loadForVerse(43003016, 43, 3, 16);
    studyStore.ensureTopics();
    await flush();
    studyStore.ensureTopics();
    await flush();

    expect(getTopicsForVerse).toHaveBeenCalledTimes(1);
    expect(studyStore.topicsLoading).toBe(false);
  });

  it('asks for nothing from the tag graph when the feature is off', async () => {
    init({ tagGraph: false });
    resetStore();

    studyStore.loadForVerse(43003016, 43, 3, 16);
    studyStore.ensureTopics();
    await flush();

    // Topics still load — only the entity half is gone.
    expect(getTopicsForVerse).toHaveBeenCalledWith(43003016);
    expect(getEntitiesForVerse).not.toHaveBeenCalled();
    expect(studyStore.verseEntities).toEqual([]);
  });
});
