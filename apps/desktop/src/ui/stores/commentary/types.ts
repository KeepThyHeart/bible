// Commentary module metadata
export interface CommentaryModule {
  module_id?: number;
  abbreviation: string;
  name: string;
  language_code?: string;
  version?: string;
  database_path: string;
}

// Commentary entry from database
export interface CommentaryEntry {
  entry_id?: number;
  verse_id_start?: number;
  verse_id_end?: number;
  entry_level: 'book' | 'chapter' | 'passage' | 'verse';
  content: string;
  word_count?: number;
}

// Commentary entry summary for tree view
export interface CommentaryEntrySummary {
  verse_id_start: number;
  verse_id_end?: number;
  entry_level: 'book' | 'chapter' | 'passage' | 'verse';
  word_count?: number;
}

// Open commentary tab
export interface CommentaryTab {
  abbreviation: string;
  name: string;
}

// Overview/Home tab data for a single commentary module
export interface CommentaryHomeModuleData {
  abbreviation: string;
  name: string;
  entries: CommentaryEntry[];
  totalWordCount: number;
}

/**
 * Per-panel-instance state for a Commentary panel.
 * Each dockview panel gets its own independent copy of this state.
 */
export interface CommentaryPanelState {
  openTabs: CommentaryTab[];
  activeTabIndex: number;
  currentVerseId: number | null;
  pinned: boolean;
  pinnedVerseId: number | null;
  /**
   * The Bible pane's verse as of the most recent `syncWithBibleVerse` call,
   * updated unconditionally - including while pinned. `currentVerseId` is
   * frozen while pinned (syncWithBibleVerse returns before updating it), so
   * without this separate field there is no way to tell whether the Bible
   * pane has actually navigated away from the pinned verse: comparing
   * `pinnedVerseId !== currentVerseId` can never be true while pinned, since
   * both stay locked to the verse that was current at pin time. The
   * "commentary is pinned, sync to catch up?" banner is driven off
   * `pinned && liveBibleVerseId !== pinnedVerseId` instead.
   */
  liveBibleVerseId: number | null;
  homeData: CommentaryHomeModuleData[];
  homeLoading: boolean;
  homeDataVerseId: number | null;
  isRestoringSession: boolean;
  entriesByTab: Map<string, CommentaryEntry[]>;
  loadingByTab: Map<string, boolean>;
  errorByTab: Map<string, string | null>;
  browseModeByTab: Map<string, boolean>;
  entrySummariesByTab: Map<string, CommentaryEntrySummary[]>;
  loadingSummariesByTab: Map<string, boolean>;
  /**
   * Bumped every time a tab is brought forward because someone ASKED for it -
   * the reader picking a module, or another pane opening one on their behalf.
   * Not bumped when a tab is merely added to populate the pane.
   *
   * `CommentaryPane` keeps "am I showing Overview?" in component state and
   * needs to know when to give that up. Watching the tab *count* instead would
   * break on a new user: `AppInitService` opens a default commentary on first
   * launch, after the pane has mounted, so the count would grow, Overview
   * would be dropped, and a new user would land on a single commentary
   * instead of the list of everything available for the verse. Intent is the
   * thing that should move the pane, not bookkeeping, so the pane watches
   * this instead.
   */
  tabActivationSeq: number;
}

export function createDefaultPanelState(): CommentaryPanelState {
  return {
    openTabs: [],
    activeTabIndex: 0,
    currentVerseId: null,
    pinned: false,
    pinnedVerseId: null,
    liveBibleVerseId: null,
    homeData: [],
    homeLoading: false,
    homeDataVerseId: null,
    isRestoringSession: false,
    entriesByTab: new Map(),
    loadingByTab: new Map(),
    errorByTab: new Map(),
    browseModeByTab: new Map(),
    entrySummariesByTab: new Map(),
    loadingSummariesByTab: new Map(),
    tabActivationSeq: 0,
  };
}

import type { PanelLifecycleSlice } from '../helpers/createPanelSlice';
import type { SharedSlice } from './slices/sharedSlice';
import type { TabSlice } from './slices/tabSlice';
import type { ContentSlice } from './slices/contentSlice';
import type { NavigationSlice } from './slices/navigationSlice';
import type { SessionSlice } from './slices/sessionSlice';

export type CommentaryState =
  PanelLifecycleSlice<CommentaryPanelState>
  & SharedSlice
  & TabSlice
  & ContentSlice
  & NavigationSlice
  & SessionSlice;
