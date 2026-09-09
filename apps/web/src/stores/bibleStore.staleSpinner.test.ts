/**
 * "Loading..." over an empty chapter, forever.
 *
 * The spinner is deferred by 80ms so a fast chapter never flashes one. That
 * timer belongs to a particular load, but `tab.loading` is a single flag on a
 * shared tab and only the *newest* load ever lowers it again. So when two loads
 * overlapped and both answered quickly — a warm chapter, or a downloaded module
 * reading from OPFS in about a millisecond — the abandoned one's timer fired
 * after the winner had already finished, raised the spinner, and nothing was
 * left to lower it. The pane sat on "Loading..." with no verses under it.
 *
 * It only reproduced when both loads were fast, which is why it showed up
 * against a warmed server under parallel load and never in isolation.
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
    text: `text ${verse}`,
    text_html: `text ${verse}`,
    is_paragraph_start: false,
    words_of_christ: false,
  };
}

/** A provider whose responses are released by hand, keyed by "book:chapter". */
function deferredProvider() {
  const pending = new Map<string, () => void>();
  const provider = {
    getChapter: vi.fn(
      (_module: string, book: number, chapter: number) =>
        new Promise(resolve => {
          pending.set(`${book}:${chapter}`, () =>
            resolve({
              verses: [makeVerse(book, chapter, 1)],
              hasInterlinearData: false,
              coveredBooks: undefined,
            }),
          );
        }),
    ),
    getVerseOfTheDay: vi.fn(async () => null),
  };
  return {
    provider: provider as never,
    release: async (book: number, chapter: number) => {
      pending.get(`${book}:${chapter}`)?.();
      pending.delete(`${book}:${chapter}`);
      // Two turns: one for getChapter's promise, one for the caller's await.
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

describe('bibleStore — an abandoned load cannot leave the spinner up', () => {
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

  it('clears the spinner when the superseded load answers first', async () => {
    // Revelation 22 is asked for, then Genesis 1 before it has answered.
    void bibleStore.navigateTo(66, 22, 1);
    void bibleStore.navigateTo(1, 1, 1);

    // Both are warm, so both answer well inside the 80ms deferral — the
    // abandoned one first.
    await deferred.release(66, 22);
    await deferred.release(1, 1);

    const tab = bibleStore.getActiveTab()!;
    expect(tab.verses).toHaveLength(1);
    expect(tab.loading).toBe(false);

    // The abandoned load's timer comes due only now. Before the fix it raised
    // the spinner here, over a chapter that had finished loading.
    vi.advanceTimersByTime(200);
    expect(bibleStore.getActiveTab()?.loading).toBe(false);
  });

  it('clears the spinner when the superseded load never answers', async () => {
    void bibleStore.navigateTo(66, 22, 1);
    void bibleStore.navigateTo(1, 1, 1);

    await deferred.release(1, 1);
    expect(bibleStore.getActiveTab()?.loading).toBe(false);

    // Revelation 22 is still out and its timer fires. It is nobody's spinner
    // now: the tab is showing Genesis 1.
    vi.advanceTimersByTime(200);
    expect(bibleStore.getActiveTab()?.loading).toBe(false);

    await deferred.release(66, 22);
    expect(bibleStore.getActiveTab()?.loading).toBe(false);
    expect(bibleStore.getActiveTab()?.verses[0]?.book_number).toBe(1);
  });

  it('still raises the spinner for a load that is genuinely slow', async () => {
    void bibleStore.navigateTo(43, 3, 1);

    vi.advanceTimersByTime(200);
    expect(bibleStore.getActiveTab()?.loading).toBe(true);

    await deferred.release(43, 3);
    expect(bibleStore.getActiveTab()?.loading).toBe(false);
  });
});
