// Define the verse type (matching BibleVerse model)
export interface BibleVerse {
  verse_id: number;
  book_number: number;
  chapter: number;
  verse: number;
  text: string;
  text_html?: string;
  is_paragraph_start?: boolean;
  words_of_christ?: boolean;
  formatting?: any;
  metadata?: any;
}

// Bible module metadata
export interface BibleModule {
  module_id?: number;
  abbreviation: string;
  name: string;
  language_code?: string;
  version?: string;
  database_path: string;
}

// Display mode options
export type DisplayMode = 'standard' | 'reading' | 'study';

/**
 * Display mode used for Bible tabs on a fresh profile.
 *
 * Standard (not Reading) so verse numbers are visible out of the box - this
 * is a Bible *study* app, and the spec calls for a study-oriented landing
 * state. Only affects new tabs; a restored session keeps its saved mode.
 */
export const DEFAULT_DISPLAY_MODE: DisplayMode = 'standard';

// Study mode options (per tab)
export interface StudyModeOptions {
  showFootnotes: boolean;
  showCrossReferences: boolean;
  showInterlinear: boolean;
  interlinearLayout: 'stacked' | 'inline';
  showUserCrossRefs: boolean;
  /**
   * The "Commentaries:" row of links under each verse in Study mode
   * (`study/VerseLinksDisplay.tsx`). On by default - this switch exists so a
   * reader who wants the passage without a row of module abbreviations under
   * every verse can say so, not to hide the feature.
   */
  showCommentaryLinks: boolean;
}

import type { ChapterVisit } from './internals/visitStack';
export type { ChapterVisit };

// Navigation history entry (KAN-29)
export interface HistoryEntry {
  verseId: number;  // The verse navigated to (used for scrolling to correct verse)
  bookNumber: number;
  chapter: number;
  bookName: string;
  scrollTop?: number; // Scroll position to restore when navigating back/forward
}

// Default study mode options
export const DEFAULT_STUDY_OPTIONS: StudyModeOptions = {
  showFootnotes: true,
  showCrossReferences: true,
  showInterlinear: false,
  interlinearLayout: 'inline',
  showUserCrossRefs: true,
  showCommentaryLinks: true
};

// Open Bible translation tab
export interface BibleTab {
  tabId: string; // Unique identifier for this tab instance
  abbreviation: string;
  name: string;
  displayMode: DisplayMode;
  moduleId?: number; // Module ID for this Bible (from module_metadata table)
  // Per-tab navigation state
  book: number;
  chapter: number;
  bookName: string;
  selectedVerseId: number | null;
  history: HistoryEntry[];
  historyIndex: number;
  // Chapter-level toggle preferences (persisted per tab - this record, not
  // `studyOptionsByTab`, is what the session writes; see
  // `sessionSlice.studyOptionsFor`).
  //
  // `showInterlinear` is deliberately TRI-state: `undefined` means "the reader
  // has never decided", which is what lets `setDisplayMode` seed the
  // interlinear-on default the first time a passage enters Study mode without
  // overriding a passage the reader explicitly turned it off for.
  showInterlinear?: boolean;
  showNotes?: boolean;
  /**
   * Study mode's "Commentaries:" verse-links row. Undefined = on, matching
   * `DEFAULT_STUDY_OPTIONS.showCommentaryLinks`, so a session written before
   * this switch existed restores with the row still showing.
   */
  showCommentaryLinks?: boolean;
}

/**
 * Serialized state for a single Bible panel.
 *
 * Since the tab restructure, one panel shows exactly one passage, so a panel's
 * persisted state is one `BibleTab` (which already carries book/chapter/history/
 * displayMode/toggles) plus the panel-level parallel-view settings.
 */
export interface BiblePanelSession {
  tab: BibleTab;
  isParallelViewMode?: boolean;
  parallelVersions?: string[];
  /**
   * The Back button's temporal stack of chapters visited (see
   * `internals/visitStack.ts`). Optional and additive: a session written by an
   * older build simply has none, and the restore seeds a one-entry stack from
   * the passage it is restoring - which is exactly the state a freshly opened
   * passage has, so no schema version bump is needed.
   */
  visitStack?: ChapterVisit[];
}

/** Current schema version of `sessionData.bible`. */
export const BIBLE_SESSION_VERSION = 2;

/**
 * `sessionData.bible` as written by this build.
 *
 * The legacy v1 fields (`openTabs` / `activeTabIndex` / `current*`) are still
 * emitted as a read-only mirror of the primary panel so that an older build -
 * or any consumer that sniffs `bible.openTabs.length` - keeps working after a
 * downgrade. Nothing in this build reads them except the v1 migration path.
 */
export interface BibleSessionData {
  version: typeof BIBLE_SESSION_VERSION;
  panels: Record<string, BiblePanelSession>;
  /** @deprecated v1 mirror - kept for downgrade safety only. */
  openTabs?: BibleTab[];
  /** @deprecated v1 mirror. */
  activeTabIndex?: number;
  /** @deprecated v1 mirror. */
  currentBook?: number;
  /** @deprecated v1 mirror. */
  currentChapter?: number;
  /** @deprecated v1 mirror. */
  selectedVerseId?: number | null;
}

/**
 * A Bible panel that the session describes but the restored dockview layout
 * does not contain yet - i.e. a passage restored from a legacy sub-tab. The
 * layout creates these once dockview is ready.
 */
export interface PendingBiblePanel {
  panelId: string;
  title: string;
  subtitle: string;
}

/**
 * Per-panel-instance state for a Bible panel.
 * Each dockview panel gets its own independent copy of this state.
 *
 * `openTabs` is retained as the per-passage record (it owns the passage's
 * history, display mode and toggle preferences, and keys the verse/study-option
 * caches), but the array now holds **at most one** entry: a passage is a
 * top-level dockview panel, not a sub-tab. See
 * `docs/Design/BiblePaneTabRestructure.md`.
 */
export interface BiblePanelState {
  openTabs: BibleTab[];
  activeTabIndex: number;
  isParallelViewMode: boolean;
  parallelVersions: string[];
  currentBook: number;
  currentChapter: number;
  currentBookName: string;
  selectedVerseId: number | null;
  /**
   * The far end of a shift-click passage selection, or null when only one
   * verse is selected.
   *
   * `selectedVerseId` stays the *anchor* - the verse the reader clicked, and
   * the one commentary/notes/study panes follow - so this may sit either above
   * or below it. Use `computeSelectedRange` (internals/verseRange.ts) to get an
   * ordered pair.
   *
   * Deliberately **not** mirrored onto `BibleTab`, which is what the session
   * persists: a range is a transient gesture, and restoring a session into a
   * half-highlighted chapter would look like a rendering bug. This matches the
   * web app, which writes null for the same field on save.
   */
  selectionEndVerseId: number | null;
  /**
   * A verse being *looked at* rather than chosen - the anchor of a preview.
   *
   * Following a scripture link (a cross-reference, a topic's passage list, a
   * commentary's citation) must not move `selectedVerseId`, which every study
   * pane follows - otherwise a reader tracing five cross-references from John
   * 3:16 would come back to find the commentary, the notes and the topics
   * pane all pointing at the fifth one, with no way back to where they had
   * been. A preview marks the verse in the text and leaves `selectedVerseId`
   * - and therefore every pane that follows it - exactly where the reader put
   * it.
   *
   * Cleared by any real selection: clicking a verse, shift-clicking, or an
   * explicit navigation. See `navigateToPreview` / `adoptPreview`.
   */
  previewVerseId: number | null;
  /** Far end of a previewed *range*, e.g. a cross-reference to Rom 8:28-30. */
  previewVerseEndId: number | null;
  /**
   * The verse the "<- Back to ..." bar returns to, and the bar's own visibility.
   *
   * Only set when a preview left the chapter the reader was in: within a
   * chapter the verse they came from is still on screen, so a bar offering to
   * take them back to it would be noise.
   */
  backBarVerseId: number | null;
  scrollTrigger: number;
  scrollMode: 'center' | 'nearest';
  navigationHistory: HistoryEntry[];
  historyIndex: number;
  maxHistorySize: number;
  /**
   * Back button state - a plain temporal stack of chapters this panel has
   * shown, newest last. Deliberately separate from `navigationHistory`, which
   * dedupes and collapses paging for the dropdown's benefit. See
   * `internals/visitStack.ts`.
   */
  visitStack: ChapterVisit[];
  versesByTab: Map<string, BibleVerse[]>;
  loadingByTab: Map<string, boolean>;
  errorByTab: Map<string, string | null>;
  studyOptionsByTab: Map<string, StudyModeOptions>;
}

export function createDefaultPanelState(): BiblePanelState {
  return {
    openTabs: [],
    activeTabIndex: 0,
    isParallelViewMode: false,
    parallelVersions: [],
    currentBook: 43, // Default to John
    currentChapter: 3,
    currentBookName: 'John',
    selectedVerseId: null,
    selectionEndVerseId: null,
    previewVerseId: null,
    previewVerseEndId: null,
    backBarVerseId: null,
    scrollTrigger: 0,
    scrollMode: 'nearest',
    navigationHistory: [],
    historyIndex: -1,
    maxHistorySize: 10,
    visitStack: [],
    versesByTab: new Map(),
    loadingByTab: new Map(),
    errorByTab: new Map(),
    studyOptionsByTab: new Map(),
  };
}

// Forward-declared BibleState interface - slices reference this via StateCreator.
// The interface is assembled from the slice interfaces in ./useBibleStore.ts.
import type { SharedSlice } from './slices/sharedSlice';
import type { TabSlice } from './slices/tabSlice';
import type { TabOptionsSlice } from './slices/tabOptionsSlice';
import type { PassageSlice } from './slices/passageSlice';
import type { VerseSlice } from './slices/verseSlice';
import type { NavigationSlice } from './slices/navigationSlice';
import type { PreviewSlice } from './slices/previewSlice';
import type { SessionSlice } from './slices/sessionSlice';
import type { PanelLifecycleSlice } from '../helpers/createPanelSlice';

export type BibleState =
  PanelLifecycleSlice<BiblePanelState>
  & SharedSlice
  & TabSlice
  & TabOptionsSlice
  & PassageSlice
  & VerseSlice
  & NavigationSlice
  & PreviewSlice
  & SessionSlice;
