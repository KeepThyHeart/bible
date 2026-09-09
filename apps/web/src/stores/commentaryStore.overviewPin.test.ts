import type { ICommentaryDataProvider } from '../providers/interfaces';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { commentaryStore, HOME_TAB_ID } from './commentaryStore';

/**
 * The Overview (Home) tab's pin button has to work like every other tab's.
 *
 * Bailing out of `pinTab` on `tabId === HOME_TAB_ID` leaves a button that
 * renders, highlights on hover, and does nothing, while the identical button on
 * every module tab works. A control that is visible, enabled, and inert is
 * worse than an absent one.
 *
 * These tests pin both halves: the pin takes, and a pinned Overview keeps its
 * data when the Bible pane moves to another chapter (which is the entire point
 * of pinning it).
 */
/**
 * Inject a stub commentary provider.
 *
 * `provider` is private on `CommentaryStore`, and these tests want it without
 * `init()`'s session restore and tab seeding — so the modifier has to be
 * stepped past. Confined to this one commented helper rather than repeated at
 * every call site; TypeScript only began flagging it when test files entered
 * the type-check.
 */
function setProvider(stub: Partial<ICommentaryDataProvider>): void {
  (commentaryStore as unknown as { provider: ICommentaryDataProvider }).provider =
    stub as ICommentaryDataProvider;
}

describe('commentaryStore — pinning the Overview tab', () => {
  beforeEach(() => {
    setProvider({ getCommentary: vi.fn().mockResolvedValue({ entries: [] }) });
    commentaryStore.tabs = [
      { id: HOME_TAB_ID, moduleAbbr: '__home__', moduleName: 'Overview' },
      { id: 'ctab-1', moduleAbbr: 'Barnes', moduleName: 'Barnes' },
    ];
    commentaryStore.activeTabId = HOME_TAB_ID;
    commentaryStore.syncedBook = 43;
    commentaryStore.syncedChapter = 3;
    commentaryStore.homeData = null;
    commentaryStore.entriesByTab.clear();
  });

  it('pins the Overview tab to the current passage', () => {
    commentaryStore.togglePin(43003016);

    expect(commentaryStore.pinned).toBe(true);
    expect(commentaryStore.pinnedBook).toBe(43);
    expect(commentaryStore.pinnedChapter).toBe(3);
    expect(commentaryStore.pinnedVerse).toBe(43003016);
  });

  it('unpins again on a second toggle', () => {
    commentaryStore.togglePin(43003016);
    commentaryStore.togglePin(43003016);

    expect(commentaryStore.pinned).toBe(false);
    expect(commentaryStore.pinnedBook).toBeNull();
    expect(commentaryStore.pinnedVerse).toBeNull();
  });

  it('keeps the pinned Overview data when the Bible pane changes chapter', () => {
    commentaryStore.togglePin(43003016);
    commentaryStore.homeData = { verseModules: [], passageModules: [], chapterModules: [] };
    commentaryStore.homeLoading = false;

    commentaryStore.loadForChapter(1, 1);

    expect(commentaryStore.homeData).not.toBeNull();
    expect(commentaryStore.homeLoading).toBe(false);
  });

  it('still clears Overview data on a chapter change when it is not pinned', () => {
    commentaryStore.homeData = { verseModules: [], passageModules: [], chapterModules: [] };

    commentaryStore.loadForChapter(1, 1);

    expect(commentaryStore.homeData).toBeNull();
    expect(commentaryStore.homeLoading).toBe(true);
  });
});
