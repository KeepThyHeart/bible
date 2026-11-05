/**
 * W-031: phone Back after paging with the Next-chapter button.
 *
 * A chapter step replaces the tab's own history entry but pushes one browser entry
 * per chapter, so after John 3 → 4 → 5 → 6 the tab has nothing to "go back" to
 * while the browser still holds 5, 4 and 3. The phone Back handler used to look
 * only at the tab's history and went Home with the URL still on John 6.
 * `browserBackStep` / `followBrowserBack` follow the entry Back landed on instead.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { bibleStore, browserBackStep } from './bibleStore';
import type { VerseData } from '../types';

function makeVerse(verse: number, book: number, chapter: number): VerseData {
  return {
    verse_id: book * 1000000 + chapter * 1000 + verse,
    text: `verse ${verse}`,
    text_html: `verse ${verse}`,
    is_paragraph_start: false,
    words_of_christ: false,
  } as VerseData;
}

function reset() {
  localStorage.clear();
  bibleStore.tabs = [];
  bibleStore.activeTabId = '';
  bibleStore.init({
    getChapter: vi.fn(async (_m: string, book: number, chapter: number) => ({
      verses: [1, 2, 3].map(v => makeVerse(v, book, chapter)),
      hasInterlinearData: false,
      coveredBooks: undefined,
    })),
    getVerseOfTheDay: vi.fn(async () => null),
  } as never);
}

const tab = (book: number, chapter: number, history: [number, number][], historyIndex = history.length - 1) => ({
  moduleAbbr: 'KJV', book, chapter, historyIndex,
  history: history.map(([b, c]) => ({ moduleAbbr: 'KJV', book: b, chapter: c })),
});

describe('browserBackStep', () => {
  it('follows a browser entry for another chapter the tab history no longer holds', () => {
    // Paged John 3 → 6 with the Next button: one replaced history entry.
    expect(browserBackStep(tab(43, 6, [[43, 6]]), '#/KJV/43/5')).toBe('hash');
  });

  it('uses the tab history when the landed entry is its previous one', () => {
    expect(browserBackStep(tab(45, 8, [[43, 3], [45, 8]]), '#/KJV/43/3')).toBe('history');
    expect(browserBackStep(tab(45, 8, [[43, 3], [45, 8]]), '#/KJV/43/3/16')).toBe('history');
  });

  it('does nothing for the passage already open or a non-reader hash', () => {
    expect(browserBackStep(tab(43, 6, [[43, 6]]), '#/KJV/43/6')).toBe('none');
    expect(browserBackStep(tab(43, 6, [[43, 6]]), '#/KJV/43/6/2')).toBe('none');
    expect(browserBackStep(tab(43, 6, [[43, 6]]), '')).toBe('none');
    expect(browserBackStep(tab(43, 6, [[43, 6]]), '#/@games')).toBe('none');
  });
});

describe('bibleStore.followBrowserBack', () => {
  beforeEach(reset);

  it('steps back through chapters paged with the Next button', async () => {
    await bibleStore.navigateTo(43, 3);
    for (const c of [4, 5, 6]) await bibleStore.navigateTo(43, c, undefined, { replace: true });
    expect(bibleStore.canGoBack()).toBe(false);

    expect(bibleStore.followBrowserBack('#/KJV/43/5')).toBe(true);
    await vi.waitFor(() => expect(bibleStore.getActiveTab()?.chapter).toBe(5));
    expect(bibleStore.followBrowserBack('#/KJV/43/5')).toBe(false);
  });
});
