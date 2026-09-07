/**
 * "The selector said KJV but the text was WEBBE."
 *
 * A tab is a shared mutable object and every chapter load writes `tab.verses`
 * after an `await`, with nothing recording which load it belonged to. The last
 * promise to *resolve* therefore won, regardless of which was asked for last —
 * and the two are routinely different, because a downloaded module answers
 * from OPFS in about a millisecond while one that is not answers from the
 * server in about a hundred.
 *
 * `moduleAbbr` meanwhile updates synchronously, because the selector has to
 * respond to the click. So a stale load landing afterwards left the new
 * translation's name over the old translation's text, and `saveSession`
 * persisted that pair for the next cold start to render without re-fetching.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { bibleStore } from './bibleStore';
import type { VerseData } from '../types';

function makeVerse(module: string, verse: number): VerseData {
  return {
    verse_id: 43 * 1000000 + 10 * 1000 + verse,
    book_number: 43,
    chapter: 10,
    verse,
    text: `${module} text ${verse}`,
    text_html: `${module} text ${verse}`,
    is_paragraph_start: false,
    words_of_christ: false,
  };
}

/** A provider whose per-module responses are released by hand. */
function deferredProvider() {
  const pending = new Map<string, () => void>();
  const provider = {
    getChapter: vi.fn(
      (module: string) =>
        new Promise(resolve => {
          pending.set(module, () =>
            resolve({ verses: [makeVerse(module, 7)], hasInterlinearData: false, coveredBooks: undefined }),
          );
        }),
    ),
    getVerseOfTheDay: vi.fn(async () => null),
  };
  return {
    provider: provider as never,
    /** Let one module's in-flight request resolve. */
    release: async (module: string) => {
      pending.get(module)?.();
      pending.delete(module);
      // Two turns: one for getChapter's promise, one for the caller's await.
      await Promise.resolve();
      await Promise.resolve();
    },
    isPending: (module: string) => pending.has(module),
  };
}

function reset(provider: unknown) {
  localStorage.clear();
  bibleStore.tabs = [];
  bibleStore.activeTabId = '';
  bibleStore.init(provider as never);
}

describe('bibleStore — a stale chapter load cannot overwrite a newer one', () => {
  let deferred: ReturnType<typeof deferredProvider>;

  beforeEach(() => {
    deferred = deferredProvider();
    reset(deferred.provider);
  });

  it('keeps the newest translation when an older request resolves last', async () => {
    // A tab only reloads on a translation change once it is on a chapter.
    void bibleStore.navigateTo(43, 10, 7);
    await deferred.release('KJV');

    // Reader switches to WEBBE.
    void bibleStore.setTabTranslation(bibleStore.activeTabId, 'WEBBE');
    await deferred.release('WEBBE');
    expect(bibleStore.getActiveTab()?.verses[0]?.text).toContain('WEBBE');

    // Now two loads overlap: a WEBBE navigation, then a switch to KJV. KJV is
    // asked for second, so it must win — even though WEBBE answers last.
    void bibleStore.navigateToPreview(43, 10, 7);
    void bibleStore.setTabTranslation(bibleStore.activeTabId, 'KJV');
    await deferred.release('KJV');
    await deferred.release('WEBBE');

    const tab = bibleStore.getActiveTab()!;
    expect(tab.moduleAbbr).toBe('KJV');
    expect(tab.verses[0]?.text).toContain('KJV');
    // The label and the text agree, which is the whole point.
    expect(tab.versesModule).toBe(tab.moduleAbbr);
  });

  it('records which translation the verses on screen came from', async () => {
    void bibleStore.navigateTo(43, 10, 7);
    await deferred.release('KJV');

    void bibleStore.setTabTranslation(bibleStore.activeTabId, 'ASV');
    await deferred.release('ASV');

    expect(bibleStore.getActiveTab()?.versesModule).toBe('ASV');
  });
});

describe('bibleStore — a failed translation switch does not keep the old text', () => {
  beforeEach(() => {
    localStorage.clear();
    bibleStore.tabs = [];
    bibleStore.activeTabId = '';
    bibleStore.init({
      getChapter: vi.fn(async (module: string) => {
        if (module === 'GONE') throw new Error('404');
        return { verses: [makeVerse(module, 7)], hasInterlinearData: false, coveredBooks: undefined };
      }),
      getVerseOfTheDay: vi.fn(async () => null),
    } as never);
  });

  it('clears the verses so the error is the thing on screen', async () => {
    await bibleStore.navigateTo(43, 10, 7);
    await bibleStore.setTabTranslation(bibleStore.activeTabId, 'ASV');
    expect(bibleStore.getActiveTab()?.verses).toHaveLength(1);

    // BibleContent renders `loadError` only when there are no verses to render
    // instead — so leaving the old ones showed the *previous* translation under
    // the *new* name, with no error at all.
    await bibleStore.setTabTranslation(bibleStore.activeTabId, 'GONE');

    const tab = bibleStore.getActiveTab()!;
    expect(tab.loadError).toBeTruthy();
    expect(tab.verses).toHaveLength(0);
    expect(tab.versesModule).toBeUndefined();
  });
});

describe('bibleStore — a restored session never renders a mismatched pair', () => {
  it('drops cached verses that came from a different translation', () => {
    localStorage.setItem(
      'bible-reader-session',
      JSON.stringify({
        tabs: [
          {
            moduleAbbr: 'KJV',
            book: 43,
            chapter: 10,
            verses: [makeVerse('WEBBE', 7)],
            versesModule: 'WEBBE',
            history: [],
            historyIndex: -1,
          },
        ],
        activeTabIndex: 0,
      }),
    );

    bibleStore.tabs = [];
    bibleStore.activeTabId = '';
    bibleStore.init({
      getChapter: vi.fn(async () => ({ verses: [], hasInterlinearData: false, coveredBooks: undefined })),
      getVerseOfTheDay: vi.fn(async () => null),
    } as never);

    const tab = bibleStore.getActiveTab()!;
    expect(tab.moduleAbbr).toBe('KJV');
    // Emptied, so `loadRestoredTabs` fetches John 10 in KJV rather than
    // rendering WEBBE's text under KJV's name.
    expect(tab.verses).toHaveLength(0);
  });

  it('trusts cached verses that match, including sessions written before the field existed', () => {
    localStorage.setItem(
      'bible-reader-session',
      JSON.stringify({
        tabs: [
          {
            moduleAbbr: 'KJV',
            book: 43,
            chapter: 10,
            verses: [makeVerse('KJV', 7)],
            history: [],
            historyIndex: -1,
          },
        ],
        activeTabIndex: 0,
      }),
    );

    bibleStore.tabs = [];
    bibleStore.activeTabId = '';
    bibleStore.init({
      getChapter: vi.fn(async () => ({ verses: [], hasInterlinearData: false, coveredBooks: undefined })),
      getVerseOfTheDay: vi.fn(async () => null),
    } as never);

    expect(bibleStore.getActiveTab()?.verses).toHaveLength(1);
  });
});
