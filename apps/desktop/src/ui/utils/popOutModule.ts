/**
 * "Pop Out to Window" for a single study module.
 *
 * The tab menu pops the module straight out to a window, building the
 * payload here from arguments the caller already holds. A two-step trip
 * instead - "Open in own panel" moving the module to a fresh dockview panel
 * *inside* the main window, then that panel's own tab menu offering "Pop Out
 * to Window" - would have a hole in the middle: the second step would read
 * the module's state out of the store keyed by panel id, but a single-module
 * panel keeps its state in local React state and writes nothing to the
 * store, so what travelled to the new window would be an empty payload. The
 * commentary window would open on "Navigate to a verse to see available
 * commentaries": no module, no verse. Building the payload from arguments
 * the caller already holds, rather than from a store lookup that may find
 * nothing, avoids that. The detached window opens on the module that was
 * popped out, at the verse the reader was on.
 */
import { useBibleStore } from '../stores/useBibleStore';

/** The pane types that can carry a single module into a window. */
export type PopOutModuleType = 'commentary' | 'book' | 'dictionary';

export interface PopOutModuleOptions {
  type: PopOutModuleType;
  /** Module abbreviation, e.g. `Clarke`. */
  abbreviation: string;
  /** Display name for the tab and window title. */
  name: string;
  /**
   * Verse to open at. Omit to take the Bible pane's current verse, which is
   * what "pop this out" means from a pane that is already following along.
   */
  verseId?: number | null;
}

/**
 * The verse the primary Bible panel is on.
 *
 * Prefers the selected verse and falls back to the first verse of the loaded
 * chapter, so a reader who has not clicked anything still gets a commentary
 * window on the passage in front of them rather than an empty one.
 *
 * Reads the *first* panel rather than `DEFAULT_PANEL_ID`: a dockview-hosted
 * Bible pane registers under its own id ('bible_default' and onwards), and the
 * `'_default'` key exists only in detached windows.
 */
export function currentPrimaryVerseId(): number | null {
  // allow-getstate: event handler - imperative store access outside render
  const panel = useBibleStore.getState().panels.values().next().value;
  if (!panel) return null;
  if (panel.selectedVerseId) return panel.selectedVerseId;
  const activeTab = panel.openTabs[panel.activeTabIndex];
  if (!activeTab) return null;
  return panel.versesByTab.get(activeTab.tabId)?.[0]?.verse_id ?? null;
}

interface DetachResult {
  success: boolean;
  error?: string;
}

/**
 * Open one module in its own window.
 *
 * Resolves to false when the detach failed or the bridge is unavailable, so
 * callers can decide whether to leave the module where it was.
 */
export async function popOutModuleToWindow({
  type,
  abbreviation,
  name,
  verseId,
}: PopOutModuleOptions): Promise<boolean> {
  const detach = window.electron?.window?.detachPane;
  if (!detach) return false;

  const resolvedVerseId = verseId ?? currentPrimaryVerseId();

  // One tab, shaped the way each pane's detached-init hook expects. The
  // caches (entries, sections) are deliberately left empty: the new window
  // fetches them for itself, and a stale copy of a cache is worse than a
  // fetch. What has to travel is the *identity* - which module, which verse.
  const tab = { abbreviation, name };

  const initialState: Record<string, unknown> =
    type === 'commentary'
      ? {
          openTabs: [tab],
          activeTabIndex: 0,
          currentVerseId: resolvedVerseId,
          entriesByTab: [],
          browseModeByTab: [],
          overviewActive: false,
        }
      : type === 'book'
        ? {
            paneKind: 'book',
            openTabs: [tab],
            activeTabIndex: 0,
            currentSectionByTab: [],
            sectionsByTab: [],
            childSectionsByTab: [],
            sectionSummariesByTab: [],
          }
        : {
            // Both kinds detach as a `BookPane`; this is what makes the window a
            // dictionary rather than a bookshelf that lists none of its tabs.
            paneKind: 'dictionary',
            dictOpenTabs: [tab],
            dictActiveTabIndex: 0,
            dictEntriesByTab: [],
            currentVerseId: resolvedVerseId,
          };

  try {
    // Dictionaries ride in the "book" window type because `BookPane` is the
    // component behind both; `paneKind` above decides which kind it renders as.
    const paneType = type === 'dictionary' ? 'book' : type;
    const result = (await detach(paneType, initialState)) as DetachResult;
    if (!result.success) {
      console.error(`[popOutModule] Failed to pop out ${abbreviation}:`, result.error);
      return false;
    }
    return true;
  } catch (error) {
    console.error(`[popOutModule] Error popping out ${abbreviation}:`, error);
    return false;
  }
}
