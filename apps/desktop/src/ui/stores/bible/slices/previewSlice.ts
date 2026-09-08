/**
 * Preview navigation - "show me that verse, but don't move my study".
 *
 * ## The problem
 *
 * A study session has a verse at the centre of it. The commentary pane, the
 * notes pane, the study pane and the topics pane all follow whichever verse
 * the reader selected, and that is the point: they are showing what is known
 * about *this* verse.
 *
 * Reading, though, is full of side trips. A cross-reference, a passage in a
 * topic list, a citation inside a commentary entry - following one of those is
 * not a decision to study a different verse, it is a glance. Before this,
 * every such glance called the same `navigateToVerse` a real selection did, so
 * it moved `selectedVerseId`, and every pane followed. Trace five
 * cross-references out of John 3:16 and the whole workspace had quietly
 * relocated to the fifth of them, with nothing pointing home.
 *
 * ## The model
 *
 * Two verses per panel, not one:
 *
 *  - `selectedVerseId` - what the reader chose. Study panes follow it.
 *  - `previewVerseId` - what they are looking at. Nothing follows it.
 *
 * A preview marks the verse in the Bible text (a soft underline rather than
 * the selection fill) and, when it left the chapter, raises a "<- Back to John
 * 3:16" bar. The panes are *offered* the previewed verse through each store's
 * existing suggestion banner rather than being moved to it, so adopting the
 * side trip as the new subject stays a decision the reader makes.
 *
 * Any real selection ends the preview: clicking a verse, shift-clicking to
 * extend, or navigating deliberately. This mirrors the web app, whose
 * `navigateToPreview` / `adoptPreviewAsStudy` pair this is modelled on - see
 * `apps/web/src/stores/bibleStore.ts`.
 */
import type { StateCreator } from 'zustand';
import { VerseIdHelper } from '@bible/core';
import { bibleAPI } from '../../../services/electronAPI';
import { updatePanelState } from '../../helpers/panelStateHelpers';
import { BibleState, createDefaultPanelState } from '../types';

export interface PreviewSlice {
  /**
   * Show a verse without choosing it.
   *
   * `endVerseId` marks a whole passage, which is what a cross-reference to
   * "Rom 8:28-30" actually points at.
   */
  navigateToPreview: (panelId: string, verseId: number, endVerseId?: number) => Promise<void>;
  /** Make the previewed verse the real selection. */
  adoptPreview: (panelId: string) => number | null;
  /** Drop the preview mark and the back bar. */
  clearPreview: (panelId: string) => void;
  /** Hide the back bar but leave the preview mark alone. */
  dismissBackBar: (panelId: string) => void;
  /** Return to the verse the back bar names, ending the preview. */
  returnFromPreview: (panelId: string) => Promise<void>;
}

export const createPreviewSlice: StateCreator<BibleState, [], [], PreviewSlice> = (set, get) => ({
  navigateToPreview: async (panelId: string, verseId: number, endVerseId?: number) => {
    const { bookNumber, chapter } = VerseIdHelper.parse(verseId);
    const ps = get().getPanelState(panelId);
    const activeTab = ps.openTabs[ps.activeTabIndex];
    if (!activeTab) return;

    const sameChapter = bookNumber === ps.currentBook && chapter === ps.currentChapter;

    if (sameChapter) {
      // The verse the reader came from is still on screen, so there is nothing
      // to go "back" to and no history worth recording - this is a scroll.
      set({
        panels: updatePanelState(get().panels, panelId, {
          previewVerseId: verseId,
          previewVerseEndId: endVerseId ?? null,
          scrollMode: 'center',
          scrollTrigger: ps.scrollTrigger + 1,
        }, createDefaultPanelState),
      });
      return;
    }

    // Leaving the chapter. `selectedVerseId` is deliberately untouched: it now
    // points outside the loaded chapter, which is exactly the state that says
    // "the study is still back there" - the back bar and the panes' suggestion
    // banners both read it.
    const bookName = await bibleAPI.getBookName(bookNumber);
    const returnTo = ps.selectedVerseId
      ?? VerseIdHelper.calculate(ps.currentBook, ps.currentChapter, 1);

    set({
      panels: updatePanelState(get().panels, panelId, {
        currentBook: bookNumber,
        currentChapter: chapter,
        currentBookName: bookName,
        previewVerseId: verseId,
        previewVerseEndId: endVerseId ?? null,
        // A chain of link-clicks keeps naming the verse the reader actually
        // chose, not the previous hop - the same rule the web app's history
        // `replace` gives it.
        backBarVerseId: ps.backBarVerseId ?? returnTo,
        selectionEndVerseId: null,
        scrollMode: 'center',
        scrollTrigger: ps.scrollTrigger + 1,
      }, createDefaultPanelState),
    });

    await get().loadChapterForTab(panelId, activeTab.tabId, activeTab.abbreviation, bookNumber, chapter);

    // Recorded in history and the visit stack like any other view change: the
    // reader can Back out of a preview even after dismissing the bar.
    get()._addToHistory(panelId, { verseId, bookNumber, chapter, bookName });
    get()._pushVisit(panelId, {
      verseId, bookNumber, chapter, bookName,
      abbreviation: activeTab.abbreviation,
    });
  },

  adoptPreview: (panelId: string) => {
    const ps = get().getPanelState(panelId);
    const verseId = ps.previewVerseId;
    if (verseId === null) return null;

    const updatedTabs = [...ps.openTabs];
    if (updatedTabs[ps.activeTabIndex]) {
      updatedTabs[ps.activeTabIndex] = { ...updatedTabs[ps.activeTabIndex], selectedVerseId: verseId };
    }

    set({
      panels: updatePanelState(get().panels, panelId, {
        selectedVerseId: verseId,
        selectionEndVerseId: null,
        previewVerseId: null,
        previewVerseEndId: null,
        backBarVerseId: null,
        openTabs: updatedTabs,
      }, createDefaultPanelState),
    });

    // Returned rather than broadcast: the caller knows which panes it wants to
    // move, and this slice deliberately knows nothing about them.
    return verseId;
  },

  clearPreview: (panelId: string) => {
    const ps = get().getPanelState(panelId);
    if (ps.previewVerseId === null && ps.backBarVerseId === null) return;
    set({
      panels: updatePanelState(get().panels, panelId, {
        previewVerseId: null,
        previewVerseEndId: null,
        backBarVerseId: null,
      }, createDefaultPanelState),
    });
  },

  dismissBackBar: (panelId: string) => {
    set({
      panels: updatePanelState(get().panels, panelId, { backBarVerseId: null }, createDefaultPanelState),
    });
  },

  returnFromPreview: async (panelId: string) => {
    const ps = get().getPanelState(panelId);
    const target = ps.backBarVerseId;
    if (target === null) return;

    // Clear first: `navigateToVerse` sets a real selection, and leaving the
    // preview mark behind would leave two verses claiming to be current.
    set({
      panels: updatePanelState(get().panels, panelId, {
        previewVerseId: null,
        previewVerseEndId: null,
        backBarVerseId: null,
      }, createDefaultPanelState),
    });

    await get().navigateToVerse(panelId, target);
  },
});
