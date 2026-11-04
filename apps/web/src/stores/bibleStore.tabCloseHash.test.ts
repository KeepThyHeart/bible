/**
 * W-059: closing the active tab made another tab active but left the URL hash on
 * the closed one, so a reload reopened the passage just closed.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { bibleStore } from './bibleStore';
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

async function openTabs(passages: [number, number][]) {
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
  bibleStore.tabs = [];
  for (const [b, c] of passages) await bibleStore.addTabWithPassage('KJV', b, c);
}

describe('bibleStore.removeTab — URL hash (W-059)', () => {
  beforeEach(() => history.replaceState(null, '', '/'));

  it('the hash follows the tab that becomes active, replacing the entry', async () => {
    await openTabs([[1, 1], [43, 1], [19, 23], [45, 8]]);
    const john = bibleStore.tabs[1];
    bibleStore.setActiveTab(john.id);
    expect(window.location.hash).toBe('#/KJV/43/1');
    const length = history.length;

    bibleStore.removeTab(john.id);

    expect(bibleStore.getActiveTab()?.book).toBe(19);
    expect(window.location.hash).toBe('#/KJV/19/23');
    expect(history.length).toBe(length);
  });

  it('closing an inactive tab leaves the hash alone', async () => {
    await openTabs([[1, 1], [43, 1]]);
    expect(window.location.hash).toBe('#/KJV/43/1');
    bibleStore.removeTab(bibleStore.tabs[0].id);
    expect(window.location.hash).toBe('#/KJV/43/1');
  });

  it('closing every tab drops the reader hash', async () => {
    await openTabs([[1, 1], [43, 1]]);
    for (const tab of [...bibleStore.tabs]) bibleStore.removeTab(tab.id);
    expect(bibleStore.tabs).toHaveLength(1);
    expect(window.location.hash).toBe('');
  });
});
