import {
  BIBLE_SESSION_VERSION,
  DEFAULT_DISPLAY_MODE,
  type BiblePanelSession,
  type BibleTab,
  type PendingBiblePanel,
} from './types';
import { normalizeVisitStack } from './internals/visitStack';

/**
 * Session migration for the Bible pane tab restructure.
 *
 * Before the restructure a single Bible panel held an array of passage
 * sub-tabs (`sessionData.bible.openTabs`). Now one dockview panel shows exactly
 * one passage, so every historical sub-tab has to become its own panel.
 *
 * Rules this module is written to (see docs/Design/BiblePaneTabRestructure.md):
 *
 *  - **Never lose a passage.** Every entry in a v1 `openTabs[]` comes out the
 *    other side as a panel, keeping its display mode, navigation history,
 *    selected verse and interlinear/notes toggles.
 *  - **Never crash.** Any shape that cannot be understood degrades to "no
 *    panels", which makes the app fall through to its normal default layout
 *    (John 3) rather than rendering an empty window.
 *  - **Idempotent.** Running it on already-migrated (v2) data returns that data
 *    unchanged, so a save/restore cycle is stable and a partially upgraded
 *    profile cannot be double-expanded.
 *
 * Note this only ever touches *UI layout* state. User notes, highlights and
 * bookmarks live in a separate database and are not read or written here.
 */

/** Panel id used when the layout has no Bible panel to attach the primary passage to. */
export const FALLBACK_PRIMARY_BIBLE_PANEL_ID = 'bible_default';

export interface BibleSessionMigrationReport {
  /** Schema detected in the input. */
  sourceVersion: 1 | 2 | 'empty';
  /** Panel ids that will be restored into panels the layout already contains. */
  restoredPanelIds: string[];
  /** Panel ids that the layout must create because they only exist in session data. */
  createdPanelIds: string[];
  /** How many v1 sub-tabs were expanded into their own panels (0 for v2 input). */
  legacyTabsExpanded: number;
  /** True when the input could not be understood and the app will use its defaults. */
  fellBackToDefaults: boolean;
}

export interface BibleSessionMigrationResult {
  panels: Record<string, BiblePanelSession>;
  /** Panels the dockview layout still has to create, in original tab order. */
  pending: PendingBiblePanel[];
  report: BibleSessionMigrationReport;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Fill in anything a historical tab may be missing so downstream code never sees a hole. */
function normalizeTab(raw: unknown, fallback: {
  book?: number;
  chapter?: number;
  selectedVerseId?: number | null;
}): BibleTab | undefined {
  if (!isRecord(raw)) return undefined;
  const abbreviation = typeof raw.abbreviation === 'string' ? raw.abbreviation : undefined;
  if (!abbreviation) return undefined;

  const book = typeof raw.book === 'number' ? raw.book : fallback.book ?? 43;
  const chapter = typeof raw.chapter === 'number' ? raw.chapter : fallback.chapter ?? 3;

  return {
    tabId: typeof raw.tabId === 'string' && raw.tabId
      ? raw.tabId
      : `${abbreviation}-restored-${book}-${chapter}-${Math.random().toString(36).slice(2, 9)}`,
    abbreviation,
    name: typeof raw.name === 'string' ? raw.name : abbreviation,
    displayMode: raw.displayMode === 'reading' || raw.displayMode === 'study' || raw.displayMode === 'standard'
      ? raw.displayMode
      : DEFAULT_DISPLAY_MODE,
    moduleId: typeof raw.moduleId === 'number' ? raw.moduleId : undefined,
    book,
    chapter,
    bookName: typeof raw.bookName === 'string' ? raw.bookName : '',
    selectedVerseId: typeof raw.selectedVerseId === 'number'
      ? raw.selectedVerseId
      : fallback.selectedVerseId ?? null,
    history: Array.isArray(raw.history) ? (raw.history as BibleTab['history']) : [],
    historyIndex: typeof raw.historyIndex === 'number' ? raw.historyIndex : -1,
    // Tri-state on purpose (see `BibleTab.showInterlinear`): a session that
    // never recorded a preference must restore as `undefined`, not `false`, or
    // the first switch into Study mode cannot seed the interlinear-on default.
    showInterlinear: typeof raw.showInterlinear === 'boolean' ? raw.showInterlinear : undefined,
    showNotes: raw.showNotes === true,
    // Absent = on, matching DEFAULT_STUDY_OPTIONS: every session written before
    // this switch existed had the commentary-links row showing.
    showCommentaryLinks: raw.showCommentaryLinks !== false,
  };
}

function titleFor(tab: BibleTab): string {
  return tab.bookName ? `${tab.bookName} ${tab.chapter}` : `Bible ${tab.chapter}`;
}

/**
 * Convert whatever is stored under `sessionData.bible` into one
 * `BiblePanelSession` per Bible panel.
 *
 * @param raw                    `sessionData.bible`, of any vintage (or absent).
 * @param existingBiblePanelIds  Bible panel ids present in the restored dockview
 *                               layout, in layout order. The first is treated as
 *                               the primary panel.
 */
export function migrateBibleSession(
  raw: unknown,
  existingBiblePanelIds: readonly string[]
): BibleSessionMigrationResult {
  const empty: BibleSessionMigrationResult = {
    panels: {},
    pending: [],
    report: {
      sourceVersion: 'empty',
      restoredPanelIds: [],
      createdPanelIds: [],
      legacyTabsExpanded: 0,
      fellBackToDefaults: true,
    },
  };

  if (!isRecord(raw)) return empty;

  const existing = new Set(existingBiblePanelIds);
  const primaryId = existingBiblePanelIds[0] ?? FALLBACK_PRIMARY_BIBLE_PANEL_ID;

  // -- v2: already one panel per passage --------------------------------
  if (raw.version === BIBLE_SESSION_VERSION && isRecord(raw.panels)) {
    const panels: Record<string, BiblePanelSession> = {};
    const pending: PendingBiblePanel[] = [];
    const restoredPanelIds: string[] = [];
    const createdPanelIds: string[] = [];

    for (const [panelId, value] of Object.entries(raw.panels)) {
      if (!isRecord(value)) continue;
      const tab = normalizeTab(value.tab, {});
      if (!tab) continue;
      panels[panelId] = {
        tab,
        isParallelViewMode: value.isParallelViewMode === true,
        parallelVersions: Array.isArray(value.parallelVersions)
          ? (value.parallelVersions as string[])
          : [],
        // Written since the Back button became a visit stack. Absent in every
        // earlier session, and entry-by-entry tolerant of garbage, so a
        // restored old (or corrupt) session degrades to "no visits yet" - the
        // restore then seeds a one-entry stack from the passage itself.
        visitStack: normalizeVisitStack(value.visitStack),
      };
      if (existing.has(panelId)) {
        restoredPanelIds.push(panelId);
      } else {
        createdPanelIds.push(panelId);
        pending.push({ panelId, title: titleFor(tab), subtitle: tab.abbreviation });
      }
    }

    if (Object.keys(panels).length === 0) return empty;

    return {
      panels,
      pending,
      report: {
        sourceVersion: 2,
        restoredPanelIds,
        createdPanelIds,
        legacyTabsExpanded: 0,
        fellBackToDefaults: false,
      },
    };
  }

  // -- v1: a single panel holding an array of passage sub-tabs ----------
  const rawTabs = Array.isArray(raw.openTabs) ? raw.openTabs : [];
  if (rawTabs.length === 0) return empty;

  const fallback = {
    book: typeof raw.currentBook === 'number' ? raw.currentBook : undefined,
    chapter: typeof raw.currentChapter === 'number' ? raw.currentChapter : undefined,
    selectedVerseId: typeof raw.selectedVerseId === 'number' ? raw.selectedVerseId : null,
  };

  const tabs = rawTabs
    .map(t => normalizeTab(t, fallback))
    .filter((t): t is BibleTab => !!t);

  if (tabs.length === 0) return empty;

  const rawActive = typeof raw.activeTabIndex === 'number' ? raw.activeTabIndex : 0;
  const activeIndex = rawActive >= 0 && rawActive < tabs.length ? rawActive : 0;

  const panels: Record<string, BiblePanelSession> = {};
  const pending: PendingBiblePanel[] = [];
  const createdPanelIds: string[] = [];

  // The passage that was in front keeps the primary panel, so the user lands
  // where they left off rather than on whichever passage happened to be first.
  panels[primaryId] = { tab: tabs[activeIndex], isParallelViewMode: false, parallelVersions: [] };

  // Every other sub-tab is expanded into its own panel, in the original order.
  let seq = 0;
  tabs.forEach((tab, index) => {
    if (index === activeIndex) return;
    const panelId = `bible_restored_${seq++}_${tab.abbreviation}_${tab.book}_${tab.chapter}`;
    panels[panelId] = { tab, isParallelViewMode: false, parallelVersions: [] };
    createdPanelIds.push(panelId);
    pending.push({ panelId, title: titleFor(tab), subtitle: tab.abbreviation });
  });

  return {
    panels,
    pending,
    report: {
      sourceVersion: 1,
      restoredPanelIds: [primaryId],
      createdPanelIds,
      legacyTabsExpanded: tabs.length - 1,
      fellBackToDefaults: false,
    },
  };
}

/** Collect the Bible panel ids from a serialized dockview layout, in layout order. */
export function biblePanelIdsFromLayout(dockviewState: unknown): string[] {
  if (!isRecord(dockviewState) || !isRecord(dockviewState.panels)) return [];
  const ids: string[] = [];
  for (const [id, panel] of Object.entries(dockviewState.panels)) {
    if (!isRecord(panel)) continue;
    const params = isRecord(panel.params) ? panel.params : undefined;
    if (params?.contentType === 'bible') ids.push(id);
  }
  return ids;
}
