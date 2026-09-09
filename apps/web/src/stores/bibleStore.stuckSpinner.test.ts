/**
 * "I tried loading a chapter and it hung. I refreshed and it worked."
 *
 * Reconstructed from the proxy access log: the reader was on 1 Corinthians 10
 * with the study pane open, moved to chapter 11, and sat on a spinner for 23
 * seconds. Nothing was slow — every request that morning returned immediately
 * — and the reload that rescued it never re-fetched chapter 11, because
 * `saveSession` had already cached those verses. So the load had *succeeded*
 * while the spinner was still up.
 *
 * The cause was the deferred spinner timer outliving the load that armed it.
 * `deferLoading` raises `tab.loading` 80ms in, and a superseded load returns
 * early without ever clearing it:
 *
 *   A starts -> B supersedes A -> B resolves (loading = false) ->
 *   A's timer fires (loading = true) -> A resolves, superseded, returns
 *
 * `BibleContent` treats `tab.loading` as authoritative over `tab.verses`, so
 * the reader gets a spinner over a chapter that is already loaded — with no
 * `loadError`, so no retry button either. Only a reload clears it.
 *
 * The window is wide open in practice: B only has to answer within 80ms, and a
 * prefetched or downloaded chapter answers in about a millisecond.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { bibleStore } from './bibleStore';
import type { VerseData } from '../types';

function makeVerse(book: number, chapter: number, verse: number): VerseData {
  return {
    verse_id: book * 1000000 + chapter * 1000 + verse,
    book_number: book,
    chapter,
    verse,
    text: `text ${book}/${chapter}`,
    text_html: `text ${book}/${chapter}`,
    is_paragraph_start: false,
    words_of_christ: false,
  };
}

/** Let queued microtasks run without letting the fake clock advance. */
async function flush(): Promise<void> {
  for (let i = 0; i < 4; i++) await Promise.resolve();
}

/** A provider whose per-chapter responses are released by hand. */
function deferredProvider() {
  const pending = new Map<string, () => void>();
  const key = (book: number, chapter: number) => `${book}/${chapter}`;

  const provider = {
    getChapter: vi.fn(
      (_module: string, book: number, chapter: number) =>
        new Promise(resolve => {
          pending.set(key(book, chapter), () =>
            resolve({
              verses: [makeVerse(book, chapter, 1)],
              hasInterlinearData: false,
              coveredBooks: undefined,
            }),
          );
        }),
    ),
    getVerse: vi.fn(async () => null),
    getVerseOfTheDay: vi.fn(async () => null),
  };

  return {
    provider: provider as never,
    /** Let one chapter's in-flight request resolve. */
    release: async (book: number, chapter: number) => {
      // Flush first: the request may not have been issued yet when a caller
      // kicks a load off with `void` and releases on the next line.
      await flush();
      pending.get(key(book, chapter))?.();
      pending.delete(key(book, chapter));
      await flush();
    },
  };
}

describe('bibleStore — a superseded load cannot pin the spinner', () => {
  let deferred: ReturnType<typeof deferredProvider>;

  beforeEach(() => {
    vi.useFakeTimers();
    deferred = deferredProvider();
    localStorage.clear();
    bibleStore.tabs = [];
    bibleStore.activeTabId = '';
    bibleStore.init(deferred.provider);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('leaves the spinner down when an abandoned load\'s timer comes due late', async () => {
    // Reader is on 1 Corinthians 10.
    void bibleStore.navigateTo(46, 10);
    await deferred.release(46, 10);
    expect(bibleStore.getActiveTab()?.loading).toBe(false);

    // A study-pane link starts a load that will never be the one on screen.
    void bibleStore.navigateToPreview(46, 5, 1);
    await flush();

    // Before it answers, the reader swipes on to chapter 11 — prefetched, so
    // it answers well inside the 80ms the spinner waits.
    void bibleStore.navigateTo(46, 11, undefined, { replace: true });
    await deferred.release(46, 11);

    const tab = bibleStore.getActiveTab()!;
    expect(tab.verses[0]?.text).toBe('text 46/11');
    expect(tab.loading).toBe(false);

    // The abandoned load's spinner timer now comes due.
    await vi.advanceTimersByTimeAsync(200);
    expect(tab.loading).toBe(false);

    // And its late answer still must not land on top of the newer chapter.
    await deferred.release(46, 5);
    expect(tab.loading).toBe(false);
    expect(tab.verses[0]?.text).toBe('text 46/11');
  });

  it('still raises the spinner for a load that is genuinely slow', async () => {
    void bibleStore.navigateTo(46, 10);
    await vi.advanceTimersByTimeAsync(200);
    expect(bibleStore.getActiveTab()?.loading).toBe(true);

    await deferred.release(46, 10);
    expect(bibleStore.getActiveTab()?.loading).toBe(false);
  });

  it('clears a spinner inherited from an abandoned load when restored tabs finish', async () => {
    const tab = bibleStore.getActiveTab()!;
    tab.book = 46;
    tab.chapter = 11;
    tab.verses = [];
    // Left set by a load that was superseded and returned without clearing it.
    tab.loading = true;

    const done = bibleStore.loadRestoredTabs();
    await deferred.release(46, 11);
    await done;

    expect(tab.verses).toHaveLength(1);
    expect(tab.loading).toBe(false);
  });
});
