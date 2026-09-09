import type { StateCreator } from 'zustand';
import { VerseIdHelper } from '@bible/core';
import { bibleAPI } from '../../../services/electronAPI';
import { updatePanelState } from '../../helpers/panelStateHelpers';
import {
  BibleState,
  BiblePanelSession,
  BibleTab,
  DEFAULT_STUDY_OPTIONS,
  PendingBiblePanel,
  createDefaultPanelState,
} from '../types';
import { migrateBibleSession, type BibleSessionMigrationReport } from '../sessionMigration';

export interface SessionSlice {
  /**
   * Passage state waiting to be adopted by a Bible panel, keyed by panel id.
   * Populated once at startup by `loadSessionData`; each `BiblePane` claims and
   * removes its own entry when it mounts.
   */
  sessionPanelStates: Map<string, BiblePanelSession>;

  /**
   * Bible panels the session describes that the restored layout does not
   * contain - passages a v1 session carried as sub-tabs. `DockviewLayout`
   * drains this once dockview is ready.
   */
  pendingPanelCreations: PendingBiblePanel[];

  /**
   * Ingest `sessionData.bible` (any schema version) and stage it for restore.
   * Returns the migration report so the caller can log what happened.
   */
  loadSessionData: (raw: unknown, existingBiblePanelIds: readonly string[]) => BibleSessionMigrationReport;

  /** Take (and clear) the list of panels the layout still has to create. */
  takePendingPanelCreations: () => PendingBiblePanel[];

  /** True when this panel has staged session state it should restore instead of loading defaults. */
  hasPendingSession: (panelId: string) => boolean;

  /** Adopt the staged passage for `panelId`. No-op when nothing is staged. */
  restorePanelFromSession: (panelId: string) => Promise<void>;

  /**
   * Legacy entry point kept for the detached-window path and for callers that
   * hand us a raw v1 blob for a single panel.
   */
  restoreFromSession: (panelId: string, sessionData: unknown) => Promise<void>;
}

/**
 * Seed the study-mode options map from a passage's persisted chapter toggles so
 * Study mode's interlinear/footnote features match what the user last had on.
 */
function studyOptionsFor(tab: BibleTab): Map<string, typeof DEFAULT_STUDY_OPTIONS> {
  const map = new Map<string, typeof DEFAULT_STUDY_OPTIONS>();
  map.set(tab.tabId, {
    ...DEFAULT_STUDY_OPTIONS,
    // `showInterlinear` is deliberately tri-state: `undefined` means the
    // session predates the switch, not that the reader turned it off. Study
    // mode's whole point is the interlinear, so an unrecorded preference on a
    // passage already in Study mode restores as on.
    //
    // Collapsing it with `!!` is what made interlinear vanish for anyone whose
    // saved session was already in Study mode: `setDisplayMode` seeds the
    // default, but a restore never goes through `setDisplayMode`, so nothing
    // ever turned it on and the checkbox came back unticked.
    showInterlinear: tab.showInterlinear ?? tab.displayMode === 'study',
    showFootnotes: tab.showNotes !== undefined ? !!tab.showNotes : DEFAULT_STUDY_OPTIONS.showFootnotes,
    // Absent means "written before this switch existed", which must restore as
    // on - the row was showing when that session was saved.
    showCommentaryLinks: tab.showCommentaryLinks !== undefined
      ? !!tab.showCommentaryLinks
      : DEFAULT_STUDY_OPTIONS.showCommentaryLinks,
  });
  return map;
}

export const createSessionSlice: StateCreator<BibleState, [], [], SessionSlice> = (set, get) => ({
  sessionPanelStates: new Map(),
  pendingPanelCreations: [],

  loadSessionData: (raw, existingBiblePanelIds) => {
    const { panels, pending, report } = migrateBibleSession(raw, existingBiblePanelIds);

    set({
      sessionPanelStates: new Map(Object.entries(panels)),
      pendingPanelCreations: pending,
    });

    // Deliberately loud: a session that silently half-restores is exactly the
    // failure mode this migration exists to prevent, so leave a trail.
    console.log(
      `[useBibleStore] Session restore (v${report.sourceVersion}): ` +
      `${report.restoredPanelIds.length} panel(s) restored in place ` +
      `[${report.restoredPanelIds.join(', ')}], ` +
      `${report.createdPanelIds.length} panel(s) to create ` +
      `[${report.createdPanelIds.join(', ')}], ` +
      `${report.legacyTabsExpanded} legacy sub-tab(s) expanded` +
      (report.fellBackToDefaults ? ' — nothing restorable, using defaults' : '')
    );

    return report;
  },

  takePendingPanelCreations: () => {
    const pending = get().pendingPanelCreations;
    if (pending.length === 0) return [];
    set({ pendingPanelCreations: [] });
    return pending;
  },

  hasPendingSession: (panelId: string) => get().sessionPanelStates.has(panelId),

  restorePanelFromSession: async (panelId: string) => {
    const staged = get().sessionPanelStates.get(panelId);
    if (!staged) return;

    // Claim the entry AND publish the passage in the same synchronous step.
    // The pane's default-data loader keys off "no staged session and no open
    // tab", so any gap between the two would race the default John 3 load in.
    const remaining = new Map(get().sessionPanelStates);
    remaining.delete(panelId);

    // Mirror the seeded interlinear default back onto the passage record, so
    // the next session save records a real preference rather than replaying
    // this inference - and so the two sources of truth agree from the start.
    //
    // Only when the seed actually fired. A passage restored in any other
    // display mode stays *undecided*, which is what lets `setDisplayMode` seed
    // it the first time the reader switches into Study.
    const studyOptions = studyOptionsFor(staged.tab);
    const seededInterlinear = staged.tab.showInterlinear === undefined
      && staged.tab.displayMode === 'study';
    const tab: BibleTab = seededInterlinear
      ? { ...staged.tab, showInterlinear: true }
      : { ...staged.tab };
    set({
      sessionPanelStates: remaining,
      panels: updatePanelState(get().panels, panelId, {
        openTabs: [tab],
        activeTabIndex: 0,
        isParallelViewMode: staged.isParallelViewMode === true,
        parallelVersions: staged.parallelVersions ?? [],
        currentBook: tab.book,
        currentChapter: tab.chapter,
        currentBookName: tab.bookName || '',
        selectedVerseId: tab.selectedVerseId ?? null,
        // Ranges are never persisted (see BiblePanelState.selectionEndVerseId),
        // so a restore always starts with a single selected verse.
        selectionEndVerseId: null,
        studyOptionsByTab: studyOptions,
        // Seeded true in the SAME update that publishes openTabs, so
        // loadingByTab.get(tab.tabId) is never ambiguous with "nothing to
        // load" while loadAvailableBibles/loadChapterForTab below are still
        // in flight. Without this, openTabs.length was already 1 but
        // isLoading read false (no map entry yet), and BibleVerseList's
        // render fell through to "no verses loaded" instead of a loading
        // state. loadChapterForTab (below) flips this back to false once the
        // chapter genuinely finishes loading, on both its success and error
        // paths.
        loadingByTab: new Map([[tab.tabId, true]]),
      }, createDefaultPanelState)
    });

    try {
      await get().loadAvailableBibles();
      if (tab.moduleId === undefined) {
        const bible = get().availableBibles.find(b => b.abbreviation === tab.abbreviation);
        tab.moduleId = bible?.module_id;
      }

      // Resolve the book name (older sessions may not have stored one).
      let bookName = tab.bookName;
      try {
        bookName = await bibleAPI.getBookName(tab.book);
      } catch (error) {
        console.error('[useBibleStore] Error getting book name during restore:', error);
        bookName = tab.bookName || 'Unknown';
      }

      const withName = { ...tab, bookName };
      set({
        panels: updatePanelState(get().panels, panelId, {
          openTabs: [withName],
          currentBookName: bookName,
        }, createDefaultPanelState)
      });

      await get().loadChapterForTab(panelId, tab.tabId, tab.abbreviation, tab.book, tab.chapter);

      // Restore navigation history, synthesising a single entry when the saved
      // history is empty so Back/Forward still behave sensibly.
      const history = tab.history?.length > 0 ? tab.history : [{
        verseId: tab.selectedVerseId ?? VerseIdHelper.calculate(tab.book, tab.chapter, 1),
        bookNumber: tab.book,
        chapter: tab.chapter,
        bookName,
      }];
      const historyIndex = tab.historyIndex >= 0 ? tab.historyIndex : 0;

      // The Back button's stack. A session from before this feature (or one
      // whose stack failed to parse) has none, so seed the single entry a
      // freshly opened passage would have: the reader is here, with nothing
      // behind them, and Back is correctly disabled.
      const visitStack = staged.visitStack && staged.visitStack.length > 0
        ? staged.visitStack
        : [{
            verseId: tab.selectedVerseId ?? VerseIdHelper.calculate(tab.book, tab.chapter, 1),
            bookNumber: tab.book,
            chapter: tab.chapter,
            bookName,
            abbreviation: tab.abbreviation,
          }];

      set({
        panels: updatePanelState(get().panels, panelId, {
          navigationHistory: history,
          historyIndex,
          visitStack,
        }, createDefaultPanelState)
      });
    } catch (error) {
      // A panel that fails to restore falls through to the pane's normal
      // default-data path rather than leaving an empty window.
      console.error(`[useBibleStore] Error restoring panel ${panelId} from session:`, error);
      // Defensive: loadingByTab was seeded true above. In practice
      // loadChapterForTab (which always resolves loadingByTab, on both its
      // success and error paths) sits between here and every caught error, so
      // this is a backstop rather than the normal path - but without it, an
      // error thrown before loadChapterForTab runs would leave the pane
      // stuck showing the loading skeleton forever instead of falling
      // through to a real (if empty) state.
      const failedLoadingMap = new Map(get().getPanelState(panelId).loadingByTab);
      failedLoadingMap.set(tab.tabId, false);
      set({ panels: updatePanelState(get().panels, panelId, { loadingByTab: failedLoadingMap }, createDefaultPanelState) });
    }
  },

  restoreFromSession: async (panelId: string, sessionData: unknown) => {
    const { panels } = migrateBibleSession(sessionData, [panelId]);
    const staged = panels[panelId];
    if (!staged) return;

    const merged = new Map(get().sessionPanelStates);
    merged.set(panelId, staged);
    set({ sessionPanelStates: merged });

    await get().restorePanelFromSession(panelId);
  },
});
