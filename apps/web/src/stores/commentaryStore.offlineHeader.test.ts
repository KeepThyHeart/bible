import type { ICommentaryDataProvider } from '../providers/interfaces';
import { describe, it, expect, vi } from 'vitest';
import { commentaryStore, HOME_TAB_ID } from './commentaryStore';

/**
 * W-069: the passage the commentary header names (`syncedBook`/`syncedChapter`)
 * must follow the reader even when that chapter's commentary cannot be fetched
 * (offline). A failed load leaves the pane empty, never stuck on the old passage.
 * The Bible side must in turn announce the chapter even when ITS load fails
 * (bibleStore.navigateTo emits 'commentary:load-chapter' from its catch too).
 */
describe('commentary header follows the passage when content fails to load', () => {
  it('moves syncedBook/syncedChapter although every fetch rejects', async () => {
    const offline = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    (commentaryStore as unknown as { provider: unknown }).provider = {
      getCommentary: offline, getChapterCommentary: offline, getCommentaryEntries: offline,
    } as Partial<ICommentaryDataProvider>;
    commentaryStore.tabs = [
      { id: HOME_TAB_ID, moduleAbbr: '__home__', moduleName: 'Overview' },
      { id: 'ctab-1', moduleAbbr: 'Barnes', moduleName: 'Barnes' },
    ];
    commentaryStore.activeTabId = 'ctab-1';
    commentaryStore.entries = [];
    commentaryStore.viewMounted(true);

    await commentaryStore.loadForChapter(19, 23);
    await commentaryStore.loadForChapter(1, 1);
    await new Promise(r => setTimeout(r, 0));

    expect(commentaryStore.syncedBook).toBe(1);
    expect(commentaryStore.syncedChapter).toBe(1);
    expect(commentaryStore.entries).toEqual([]);
  });
});
