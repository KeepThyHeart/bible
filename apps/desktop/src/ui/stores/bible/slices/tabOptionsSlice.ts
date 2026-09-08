import type { StateCreator } from 'zustand';
import { updatePanelState } from '../../helpers/panelStateHelpers';
import {
  BibleState,
  DisplayMode,
  StudyModeOptions,
  DEFAULT_STUDY_OPTIONS,
  createDefaultPanelState,
} from '../types';

export interface TabOptionsSlice {
  setDisplayMode: (panelId: string, tabId: string, mode: DisplayMode) => void;
  setStudyOptions: (panelId: string, tabId: string, options: Partial<StudyModeOptions>) => void;
  getStudyOptions: (panelId: string, tabId: string) => StudyModeOptions;
  setTabShowInterlinear: (panelId: string, tabId: string, value: boolean) => void;
  setTabShowNotes: (panelId: string, tabId: string, value: boolean) => void;
  toggleParallelView: (panelId: string) => void;
  setParallelVersions: (panelId: string, versions: string[]) => void;
  changeTabVersion: (panelId: string, tabId: string, abbreviation: string, name: string) => void;
}

export const createTabOptionsSlice: StateCreator<BibleState, [], [], TabOptionsSlice> = (set, get) => ({
  // Set display mode for a specific tab.
  //
  // Entering Study mode seeds the study defaults, of which interlinear-on is
  // the one that shows: Study mode is the only mode that renders an
  // interlinear line at all, and it is the reason most readers switch to it.
  //
  // Seeding this in `openBible` alone, for a tab *created* in Study mode,
  // would cover a path almost nothing takes, since `DEFAULT_DISPLAY_MODE` is
  // `standard` and the display-mode dropdown comes through here. A reader
  // switching a passage to Study mode would then get plain verses - and with
  // the toolbar's Interlinear toggle gone (one surface, at the top of the
  // chapter) the only remaining control would be a checkbox they had to find
  // and tick.
  //
  // Seeded only when the passage has no recorded preference
  // (`tab.showInterlinear === undefined`), so a reader who turned it off - in
  // this session or in a restored one - is not overridden every time they
  // leave Study mode and come back.
  setDisplayMode: (panelId: string, tabId: string, mode: DisplayMode) => {
    const ps = get().getPanelState(panelId);
    const tab = ps.openTabs.find(t => t.tabId === tabId);
    const seedStudyDefaults = mode === 'study' && tab !== undefined && tab.showInterlinear === undefined;

    const newTabs = ps.openTabs.map(t =>
      t.tabId === tabId
        ? { ...t, displayMode: mode, ...(seedStudyDefaults ? { showInterlinear: true } : {}) }
        : t
    );

    if (!seedStudyDefaults) {
      set({ panels: updatePanelState(get().panels, panelId, { openTabs: newTabs }, createDefaultPanelState) });
      return;
    }

    // Both sources of truth, in one write: the passage record (what the session
    // persists) and the options map (what StudyModeView renders from). Seeding
    // one without the other would make a toolbar toggle appear to turn
    // interlinear off on its first click.
    const currentOptions = ps.studyOptionsByTab.get(tabId) ?? DEFAULT_STUDY_OPTIONS;
    const newStudyOptionsMap = new Map(ps.studyOptionsByTab);
    newStudyOptionsMap.set(tabId, { ...currentOptions, showInterlinear: true });

    set({ panels: updatePanelState(get().panels, panelId, {
      openTabs: newTabs,
      studyOptionsByTab: newStudyOptionsMap,
    }, createDefaultPanelState) });
  },

  // Set study mode options for a specific tab.
  //
  // Interlinear, footnotes and the commentary-links row are mirrored back onto
  // the passage record (`tab.showInterlinear` / `tab.showNotes` /
  // `tab.showCommentaryLinks`) because that - not
  // `studyOptionsByTab` - is what the session persists (see
  // `sessionSlice.studyOptionsFor`). Mirroring only one way - from a toolbar
  // toggle button into this map - would leave a reader who turns interlinear
  // on from the controls at the top of the chapter finding it off again
  // after a restart. These controls are the only surface, so the
  // write-through has to happen here.
  setStudyOptions: (panelId: string, tabId: string, options: Partial<StudyModeOptions>) => {
    const ps = get().getPanelState(panelId);
    const currentOptions = ps.studyOptionsByTab.get(tabId) || { ...DEFAULT_STUDY_OPTIONS };
    const newOptions = { ...currentOptions, ...options };

    const newStudyOptionsMap = new Map(ps.studyOptionsByTab);
    newStudyOptionsMap.set(tabId, newOptions);

    const newTabs = ps.openTabs.map(tab =>
      tab.tabId === tabId
        ? {
            ...tab,
            showInterlinear: newOptions.showInterlinear,
            showNotes: newOptions.showFootnotes,
            showCommentaryLinks: newOptions.showCommentaryLinks,
          }
        : tab
    );

    set({ panels: updatePanelState(get().panels, panelId, {
      openTabs: newTabs,
      studyOptionsByTab: newStudyOptionsMap,
    }, createDefaultPanelState) });
  },

  // Get study mode options for a specific tab
  getStudyOptions: (panelId: string, tabId: string) => {
    const ps = get().getPanelState(panelId);
    return ps.studyOptionsByTab.get(tabId) || { ...DEFAULT_STUDY_OPTIONS };
  },

  // Chapter-level toggle bar preferences (per-tab, persisted with the tab).
  // Also mirrored into studyOptionsByTab so that Study mode features (which
  // read studyOptions.showInterlinear / studyOptions.showFootnotes) respect
  // the same chapter-level toggle without needing a separate control.
  setTabShowInterlinear: (panelId: string, tabId: string, value: boolean) => {
    const ps = get().getPanelState(panelId);
    const newTabs = ps.openTabs.map(tab =>
      tab.tabId === tabId ? { ...tab, showInterlinear: value } : tab
    );
    const currentOptions = ps.studyOptionsByTab.get(tabId) || { ...DEFAULT_STUDY_OPTIONS };
    const newStudyOptionsMap = new Map(ps.studyOptionsByTab);
    newStudyOptionsMap.set(tabId, { ...currentOptions, showInterlinear: value });
    set({ panels: updatePanelState(get().panels, panelId, {
      openTabs: newTabs,
      studyOptionsByTab: newStudyOptionsMap,
    }, createDefaultPanelState) });
  },

  setTabShowNotes: (panelId: string, tabId: string, value: boolean) => {
    const ps = get().getPanelState(panelId);
    const newTabs = ps.openTabs.map(tab =>
      tab.tabId === tabId ? { ...tab, showNotes: value } : tab
    );
    const currentOptions = ps.studyOptionsByTab.get(tabId) || { ...DEFAULT_STUDY_OPTIONS };
    const newStudyOptionsMap = new Map(ps.studyOptionsByTab);
    newStudyOptionsMap.set(tabId, { ...currentOptions, showFootnotes: value });
    set({ panels: updatePanelState(get().panels, panelId, {
      openTabs: newTabs,
      studyOptionsByTab: newStudyOptionsMap,
    }, createDefaultPanelState) });
  },

  // Toggle parallel view mode
  toggleParallelView: (panelId: string) => {
    const ps = get().getPanelState(panelId);
    set({ panels: updatePanelState(get().panels, panelId, { isParallelViewMode: !ps.isParallelViewMode }, createDefaultPanelState) });
  },

  // Set parallel versions for comparison
  setParallelVersions: (panelId: string, versions: string[]) => {
    set({ panels: updatePanelState(get().panels, panelId, { parallelVersions: versions }, createDefaultPanelState) });
  },

  // Change the version of an existing tab (keeps same passage)
  changeTabVersion: (panelId: string, tabId: string, abbreviation: string, name: string) => {
    const ps = get().getPanelState(panelId);
    const { availableBibles } = get();
    const tabIndex = ps.openTabs.findIndex(tab => tab.tabId === tabId);
    if (tabIndex === -1) return;

    const tab = ps.openTabs[tabIndex];
    const bible = availableBibles.find(b => b.abbreviation === abbreviation);
    const moduleId = bible?.module_id;

    const newTabs = [...ps.openTabs];
    newTabs[tabIndex] = {
      ...tab,
      abbreviation,
      name,
      moduleId,
    };
    set({ panels: updatePanelState(get().panels, panelId, { openTabs: newTabs }, createDefaultPanelState) });

    // Reload chapter with the new version
    const book = tabIndex === ps.activeTabIndex ? ps.currentBook : tab.book;
    const chapter = tabIndex === ps.activeTabIndex ? ps.currentChapter : tab.chapter;
    get().loadChapterForTab(panelId, tabId, abbreviation, book, chapter);
  },
});
