import { useCommentaryStore } from './useCommentaryStore';
import { useNotesStore } from './useNotesStore';
import { useStudyStore } from './useStudyStore';
import { useTopicsStore } from './useTopicsStore';

/**
 * Point every study pane at a verse the reader deliberately chose.
 *
 * The four panes that follow the Bible pane - Commentary, Notes, Study and
 * Topics - are not subscribed to `selectedVerseId`; each is pushed to by
 * whoever performed the navigation. Hoisted here, rather than left inside
 * `useVerseInteractionHandlers.handleVerseClick`, so every "the reader picked
 * this verse" path can share it: keeping the push there would mean *clicking*
 * a verse moved the panes but reaching the same verse any other way did not -
 * typing a reference into the search bar and pressing Enter would move the
 * Bible pane alone, and the reader would have to click the verse that was
 * already selected to make the rest of the workbench agree.
 *
 * This is for navigation, not for previewing. A scripture link is a glance -
 * see `previewVerseInPrimary` in `crossStoreBridge.ts` - and deliberately
 * leaves the panes where they are.
 *
 * Read through `getState()` rather than hooks so non-component callers (store
 * actions, event handlers) can use it too. Each store's own
 * `syncAllPanelsWithVerse` decides what a pinned panel does.
 */
export function syncPanesWithVerse(verseId: number): void {
  useCommentaryStore.getState().syncAllPanelsWithVerse(verseId);
  useNotesStore.getState().syncAllPanelsWithVerse(verseId);
  useStudyStore.getState().syncAllPanelsWithVerse(verseId);
  useTopicsStore.getState().syncAllPanelsWithVerse(verseId);
}
