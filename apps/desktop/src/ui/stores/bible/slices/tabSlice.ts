import type { StateCreator } from 'zustand';
import { VerseIdHelper } from '@bible/core';
import { updatePanelState } from '../../helpers/panelStateHelpers';
import {
  BibleState,
  BibleTab,
  DisplayMode,
  createDefaultPanelState,
  DEFAULT_DISPLAY_MODE,
  DEFAULT_STUDY_OPTIONS,
} from '../types';

export interface TabSlice {
  /**
   * Show `abbreviation` in this panel.
   *
   * One panel holds one passage, so this seeds the panel's passage when it is
   * empty and swaps the translation in place when it already has one. To read a
   * *different* passage alongside this one, use `openPassageInNewPanel`.
   */
  openBible: (panelId: string, abbreviation: string, name: string, displayMode?: DisplayMode) => void;
  /** Clear this panel's passage. The dockview panel itself is closed by the layout. */
  closeBible: (panelId: string, tabId: string) => void;
}

export const createTabSlice: StateCreator<BibleState, [], [], TabSlice> = (set, get) => ({
  openBible: (panelId: string, abbreviation: string, name: string, displayMode: DisplayMode = DEFAULT_DISPLAY_MODE) => {
    const ps = get().getPanelState(panelId);
    const { availableBibles } = get();

    const existing = ps.openTabs[0];

    // Already showing this translation - nothing to do.
    if (existing && existing.abbreviation === abbreviation) return;

    // Showing a different translation: swap the version but keep the passage,
    // the history and the reading position. Adding a second tab here would
    // produce the sub-tab band.
    if (existing) {
      get().changeTabVersion(panelId, existing.tabId, abbreviation, name);
      return;
    }

    // Generate unique tab ID (timestamp + random to ensure uniqueness)
    const tabId = `${abbreviation}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

    // Find module ID from available Bibles
    const bible = availableBibles.find(b => b.abbreviation === abbreviation);
    const moduleId = bible?.module_id;

    const { currentBook, currentChapter, currentBookName, selectedVerseId } = ps;
    const initialVerseId = selectedVerseId ?? VerseIdHelper.calculate(currentBook, currentChapter, 1);

    // Study mode defaults to interlinear on. This has to be seeded on both
    // `BibleTab.showInterlinear` (drives the toolbar toggle icon,
    // ChapterToggleButtons.tsx) and `studyOptionsByTab` (gates the actual
    // interlinear content, tabOptionsSlice.getStudyOptions) - leaving either
    // one at its false default would desync the icon from what's rendered,
    // so the user's first click would appear to turn interlinear *off*.
    // Standard/Reading tabs are unaffected: DEFAULT_STUDY_OPTIONS itself
    // stays `showInterlinear: false`.
    const isStudyMode = displayMode === 'study';

    const newTab: BibleTab = {
      tabId, abbreviation, name, displayMode, moduleId,
      book: currentBook,
      chapter: currentChapter,
      bookName: currentBookName,
      selectedVerseId: initialVerseId,
      history: [{
        verseId: initialVerseId,
        bookNumber: currentBook,
        chapter: currentChapter,
        bookName: currentBookName
      }],
      historyIndex: 0,
      ...(isStudyMode ? { showInterlinear: true } : {}),
    };

    const newStudyOptionsMap = new Map(ps.studyOptionsByTab);
    if (isStudyMode) {
      newStudyOptionsMap.set(tabId, { ...DEFAULT_STUDY_OPTIONS, showInterlinear: true });
    }

    set({
      panels: updatePanelState(get().panels, panelId, {
        openTabs: [newTab],
        activeTabIndex: 0,
        // Opening a passage replaces the selection with that passage's own
        // single verse, so no shift-click range can survive into it.
        selectionEndVerseId: null,
        navigationHistory: newTab.history,
        historyIndex: newTab.historyIndex,
        // Seed the Back button's stack with the chapter this passage opens on.
        // One entry means "nowhere to go back to", which is what disables the
        // button - the same state a freshly restored session lands in.
        visitStack: [{
          verseId: initialVerseId,
          bookNumber: currentBook,
          chapter: currentChapter,
          bookName: currentBookName,
          abbreviation,
        }],
        studyOptionsByTab: newStudyOptionsMap,
      }, createDefaultPanelState)
    });

    get().loadChapterForTab(panelId, tabId, abbreviation, currentBook, currentChapter);
  },

  closeBible: (panelId: string, tabId: string) => {
    const ps = get().getPanelState(panelId);
    if (!ps.openTabs.some(tab => tab.tabId === tabId)) return;

    const newVersesMap = new Map(ps.versesByTab);
    const newLoadingMap = new Map(ps.loadingByTab);
    const newErrorMap = new Map(ps.errorByTab);
    const newStudyOptionsMap = new Map(ps.studyOptionsByTab);

    newVersesMap.delete(tabId);
    newLoadingMap.delete(tabId);
    newErrorMap.delete(tabId);
    newStudyOptionsMap.delete(tabId);

    set({
      panels: updatePanelState(get().panels, panelId, {
        openTabs: ps.openTabs.filter(tab => tab.tabId !== tabId),
        activeTabIndex: 0,
        versesByTab: newVersesMap,
        loadingByTab: newLoadingMap,
        errorByTab: newErrorMap,
        studyOptionsByTab: newStudyOptionsMap,
      }, createDefaultPanelState)
    });
  },
});
