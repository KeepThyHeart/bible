// Store synchronization wiring.
//
// This is the ONLY module under `stores/` that is allowed to import multiple
// stores. It exists so the individual stores can stay independent and free
// of cross-store imports.
//
// Responsibilities:
//   1. Install cross-store bridge implementations (see crossStoreBridge.ts)
//      that let one store call into another without a compile-time dependency.
//   2. Wire reactive `when-context` publishers that recompute whenever any
//      of the relevant stores change.
//
// `wireStoreSync()` must be called exactly once at app startup, before any
// component renders that depends on the bridges or when-context flags. The
// current call site is `App.tsx`.

import { useBibleStore } from './useBibleStore';
import { useCommentaryStore } from './useCommentaryStore';
import { useBookmarkStore } from './useBookmarkStore';
import { useHighlightStore } from './useHighlightStore';
import { useNotesStore } from './useNotesStore';
import { useStudyStore } from './useStudyStore';
import { useTopicsStore } from './useTopicsStore';
import { DEFAULT_PANEL_ID } from './helpers/panelStateHelpers';
import { syncPanesWithVerse } from './syncPanesWithVerse';
import { whenContextService } from '../services/WhenContextService';
import { useLayoutStore } from './useLayoutStore';
import {
  setNavigateToVerseInPrimary,
  setPreviewVerseInPrimary,
  setResolvePrimaryBibleVerseId,
  setResolveOpenModuleAbbreviations,
  setShowSearchResultsPanel,
} from './crossStoreBridge';

let wired = false;

/**
 * The verse a Bible pane in *another* window last navigated to.
 *
 * Only meaningful while this window has no Bible panel of its own - see
 * `setResolvePrimaryBibleVerseId` below.
 */
let detachedBibleVerseId: number | null = null;

/**
 * Install all cross-store bridges and reactive subscriptions.
 *
 * Safe to call more than once; subsequent calls are a no-op. Tests that need
 * a clean slate can import and call the individual setters from
 * `crossStoreBridge.ts` to reset them.
 */
export function wireStoreSync(): void {
  if (wired) return;
  wired = true;

  // ==========================================================================
  // Cross-store bridges (imperative calls)
  // ==========================================================================

  // Commentary slices call this when the user clicks a verse in the
  // commentary and we want the Bible pane to follow along.
  setNavigateToVerseInPrimary((verseId: number) => {
    useBibleStore.getState().navigateToVerseInPrimary(verseId);
  });

  // Scripture *links* preview rather than select: the reader is glancing at
  // a cross-reference, not choosing a new subject, so the panes that follow
  // `selectedVerseId` stay where they are. See `bible/slices/previewSlice.ts`.
  setPreviewVerseInPrimary((verseId: number, endVerseId?: number) => {
    const bibleState = useBibleStore.getState();
    const panelId = useLayoutStore.getState().lastActiveBiblePanelId
      ?? bibleState.panels.keys().next().value;
    if (!panelId) {
      // No Bible panel yet - `navigateToVerseInPrimary` knows how to make one,
      // and a freshly opened panel has nothing to preserve anyway.
      void bibleState.navigateToVerseInPrimary(verseId);
      return;
    }
    void bibleState.navigateToPreview(panelId, verseId, endVerseId);

    // The study panes are *offered* the verse rather than moved to it, so
    // adopting a side trip as the new subject stays one click away. Notes are
    // deliberately not offered: a note is something the reader wrote about a
    // verse, and nothing about glancing at a cross-reference asks to open a
    // different one.
    useStudyStore.getState().suggestPanelsWithVerse(verseId);
    useTopicsStore.getState().suggestPanelsWithVerse(verseId);
  });

  // Commentary `openCommentary` falls back to the primary Bible panel's
  // currently-active verse when the commentary panel has no verse yet.
  //
  // With the Bible pane popped out there is no Bible panel in this window at
  // all; returning null there would make opening a commentary here appear to
  // do nothing - the tab is added, but no entry is ever loaded for it.
  // `detachedBibleVerseId` is the verse the detached Bible window last
  // reported, which is what "the Bible pane's verse" means in that layout.
  setResolvePrimaryBibleVerseId(() => {
    const bibleState = useBibleStore.getState();
    const primaryPanel = bibleState.panels.values().next().value;
    if (!primaryPanel) return detachedBibleVerseId;
    const activeTab = primaryPanel.openTabs[primaryPanel.activeTabIndex];
    if (!activeTab) return detachedBibleVerseId;
    const verses = primaryPanel.versesByTab.get(activeTab.tabId) || [];
    if (verses.length === 0) return detachedBibleVerseId;
    return verses[0].verse_id;
  });

  // Follow along with a Bible pane that lives in another window.
  //
  // main.ts forwards every window's verse change to every *other* window, so
  // this fires when a detached Bible window navigates. The study panes are
  // moved the same way a click in a docked Bible pane moves them; nothing here
  // touches this window's own Bible panels, which have their own verse.
  window.electron?.window?.onVerseChanged?.((verseId: number) => {
    detachedBibleVerseId = verseId;
    syncPanesWithVerse(verseId);
  });

  // Search store uses this to gather the full set of open module
  // abbreviations (Bible + Commentary) for the `allOpenModules` scope.
  setResolveOpenModuleAbbreviations(() => {
    const bibleStore = useBibleStore.getState();
    const commentaryStore = useCommentaryStore.getState();
    const seen = new Set<string>();
    const result: string[] = [];
    const collect = (abbr: string): void => {
      if (!seen.has(abbr)) {
        seen.add(abbr);
        result.push(abbr);
      }
    };
    bibleStore.panels.forEach(ps => {
      ps.openTabs.forEach(tab => collect(tab.abbreviation));
    });
    commentaryStore.panels.forEach(ps => {
      ps.openTabs.forEach(tab => collect(tab.abbreviation));
    });
    return result;
  });

  // The search store calls this once a search has produced results, so the
  // results get their own dockview tab (split below the active Bible pane the
  // first time, focused in place thereafter).
  setShowSearchResultsPanel(() => {
    useLayoutStore.getState().openSearchResultsPanel();
  });

  // ==========================================================================
  // When-context publishers (reactive subscriptions)
  // ==========================================================================
  //
  // Each publisher reads across two stores and writes a single flag into
  // WhenContextService. They are recomputed whenever either contributing
  // store changes, which is why they live here instead of inside one store.

  const getSelectedVerseId = (): number | null => {
    const bibleState = useBibleStore.getState();
    let ps = bibleState.panels.get(DEFAULT_PANEL_ID);
    if (!ps) {
      const firstKey = bibleState.panels.keys().next().value;
      if (firstKey) ps = bibleState.panels.get(firstKey);
    }
    return ps?.selectedVerseId ?? null;
  };

  // ---- selectedVerseIsBookmarked ----
  const publishSelectedVerseIsBookmarked = (): void => {
    const verseId = getSelectedVerseId();
    const flag =
      verseId !== null && useBookmarkStore.getState().bookmarkedVerses.has(verseId);
    whenContextService.set('selectedVerseIsBookmarked', flag);
  };
  publishSelectedVerseIsBookmarked();
  useBookmarkStore.subscribe(publishSelectedVerseIsBookmarked);
  useBibleStore.subscribe(publishSelectedVerseIsBookmarked);

  // ---- selectedVerseHasHighlight ----
  const publishSelectedVerseHasHighlight = (): void => {
    const verseId = getSelectedVerseId();
    if (verseId === null) {
      whenContextService.set('selectedVerseHasHighlight', false);
      return;
    }
    const map = useHighlightStore.getState().highlightsByModule;
    for (const highlights of map.values()) {
      for (const h of highlights) {
        if (h.coversVerse(verseId)) {
          whenContextService.set('selectedVerseHasHighlight', true);
          return;
        }
      }
    }
    whenContextService.set('selectedVerseHasHighlight', false);
  };
  publishSelectedVerseHasHighlight();
  useHighlightStore.subscribe(publishSelectedVerseHasHighlight);
  useBibleStore.subscribe(publishSelectedVerseHasHighlight);

  // ---- selectedVerseHasNote ----
  const publishSelectedVerseHasNote = (): void => {
    const verseId = getSelectedVerseId();
    if (verseId === null) {
      whenContextService.set('selectedVerseHasNote', false);
      return;
    }
    const notesState = useNotesStore.getState();
    // Prefer noteSummaries (lightweight) but fall back to verseNotes if empty.
    const summaries = notesState.noteSummaries;
    if (summaries.length > 0) {
      for (const s of summaries) {
        const start = s.verseIdStart;
        const end = s.verseIdEnd ?? start;
        if (verseId >= start && verseId <= end) {
          whenContextService.set('selectedVerseHasNote', true);
          return;
        }
      }
    }
    for (const n of notesState.verseNotes) {
      if (n.verseIdStart === undefined) continue;
      const start = n.verseIdStart;
      const end = n.verseIdEnd ?? start;
      if (verseId >= start && verseId <= end) {
        whenContextService.set('selectedVerseHasNote', true);
        return;
      }
    }
    whenContextService.set('selectedVerseHasNote', false);
  };
  publishSelectedVerseHasNote();
  useNotesStore.subscribe(publishSelectedVerseHasNote);
  useBibleStore.subscribe(publishSelectedVerseHasNote);
}
