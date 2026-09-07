/**
 * Platform-agnostic Bible tab lifecycle controller.
 *
 * Manages opening, closing, switching, and reordering Bible tabs,
 * each with its own navigation state. Extracted from the desktop
 * Zustand store so any UI framework can use it.
 */

import { VerseNavigationController, NavigationState } from './VerseNavigationController';

export type DisplayMode = 'standard' | 'reading' | 'study';

export interface StudyModeOptions {
  showFootnotes: boolean;
  showCrossReferences: boolean;
  showInterlinear: boolean;
  interlinearLayout: 'stacked' | 'inline';
  showUserCrossRefs: boolean;
}

export const DEFAULT_STUDY_OPTIONS: StudyModeOptions = {
  showFootnotes: true,
  showCrossReferences: true,
  showInterlinear: false,
  interlinearLayout: 'inline',
  showUserCrossRefs: true
};

export interface BibleTabState {
  tabId: string;
  abbreviation: string;
  name: string;
  displayMode: DisplayMode;
  moduleId?: number;
  bookNumber: number;
  chapter: number;
  bookName: string;
  selectedVerseId: number | null;
  studyOptions: StudyModeOptions;
}

/**
 * Serialized form of a Bible tab for session persistence.
 * Separate from BibleTabState because it includes `navigation: NavigationState`
 * as a plain JSON object, whereas the live BibleTabState holds a
 * VerseNavigationController class instance with methods.
 */
export interface SerializedBibleTab {
  tabId: string;
  abbreviation: string;
  name: string;
  displayMode: DisplayMode;
  moduleId?: number;
  bookNumber: number;
  chapter: number;
  bookName: string;
  selectedVerseId: number | null;
  studyOptions: StudyModeOptions;
  navigation: NavigationState;
}

export interface TabsState {
  tabs: SerializedBibleTab[];
  activeTabIndex: number;
  isParallelViewMode: boolean;
  parallelVersions: string[];
}

interface TabEntry {
  state: BibleTabState;
  navigation: VerseNavigationController;
}

export class BibleTabController {
  private tabs: TabEntry[] = [];
  private activeTabIndex = 0;
  private isParallelViewMode = false;
  private parallelVersions: string[] = [];

  /** Generate a unique tab ID. */
  private generateTabId(abbreviation: string): string {
    return `${abbreviation}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Open a new Bible tab. If a tab with this abbreviation is already open,
   * switches to it instead. Returns the tab ID.
   */
  openTab(config: {
    abbreviation: string;
    name: string;
    displayMode?: DisplayMode;
    moduleId?: number;
    bookNumber?: number;
    chapter?: number;
    bookName?: string;
    selectedVerseId?: number | null;
  }): string {
    // If already open, just select it
    const existingIndex = this.tabs.findIndex(
      t => t.state.abbreviation === config.abbreviation
    );
    if (existingIndex !== -1) {
      this.activeTabIndex = existingIndex;
      return this.tabs[existingIndex].state.tabId;
    }

    // Inherit current passage from active tab if not specified
    const active = this.getActiveTab();
    const bookNumber = config.bookNumber ?? active?.bookNumber ?? 43;
    const chapter = config.chapter ?? active?.chapter ?? 3;
    const bookName = config.bookName ?? active?.bookName ?? 'John';
    const selectedVerseId = config.selectedVerseId !== undefined
      ? config.selectedVerseId
      : active?.selectedVerseId ?? null;

    const tabId = this.generateTabId(config.abbreviation);
    const nav = new VerseNavigationController();

    // Seed navigation history
    if (selectedVerseId) {
      nav.addEntry({ verseId: selectedVerseId, bookNumber, chapter, bookName });
    }

    const entry: TabEntry = {
      state: {
        tabId,
        abbreviation: config.abbreviation,
        name: config.name,
        displayMode: config.displayMode ?? 'reading',
        moduleId: config.moduleId,
        bookNumber,
        chapter,
        bookName,
        selectedVerseId,
        studyOptions: { ...DEFAULT_STUDY_OPTIONS }
      },
      navigation: nav
    };

    this.tabs.push(entry);
    this.activeTabIndex = this.tabs.length - 1;
    return tabId;
  }

  /** Close a tab by ID. Returns true if the tab was found and closed. */
  closeTab(tabId: string): boolean {
    const index = this.tabs.findIndex(t => t.state.tabId === tabId);
    if (index === -1) return false;

    this.tabs.splice(index, 1);

    if (this.tabs.length === 0) {
      this.activeTabIndex = 0;
    } else if (index === this.activeTabIndex) {
      this.activeTabIndex = Math.max(0, index - 1);
    } else if (index < this.activeTabIndex) {
      this.activeTabIndex--;
    }

    return true;
  }

  /** Switch to a tab by index. */
  switchTab(index: number): boolean {
    if (index < 0 || index >= this.tabs.length || index === this.activeTabIndex) {
      return false;
    }
    this.activeTabIndex = index;
    return true;
  }

  /** Reorder tabs via drag-and-drop. */
  reorderTabs(sourceIndex: number, destinationIndex: number): boolean {
    if (sourceIndex < 0 || sourceIndex >= this.tabs.length ||
        destinationIndex < 0 || destinationIndex >= this.tabs.length) {
      return false;
    }

    const [moved] = this.tabs.splice(sourceIndex, 1);
    this.tabs.splice(destinationIndex, 0, moved);

    // Adjust active index
    if (this.activeTabIndex === sourceIndex) {
      this.activeTabIndex = destinationIndex;
    } else if (sourceIndex < this.activeTabIndex && destinationIndex >= this.activeTabIndex) {
      this.activeTabIndex--;
    } else if (sourceIndex > this.activeTabIndex && destinationIndex <= this.activeTabIndex) {
      this.activeTabIndex++;
    }

    return true;
  }

  /** Get the active tab's state, or undefined if no tabs are open. */
  getActiveTab(): BibleTabState | undefined {
    return this.tabs[this.activeTabIndex]?.state;
  }

  /** Get the active tab's navigation controller. */
  getActiveNavigation(): VerseNavigationController | undefined {
    return this.tabs[this.activeTabIndex]?.navigation;
  }

  /** Get the active tab index. */
  getActiveTabIndex(): number {
    return this.activeTabIndex;
  }

  /** Get all tab states (read-only). */
  getAllTabs(): BibleTabState[] {
    return this.tabs.map(t => t.state);
  }

  /** Get a tab's state by ID. */
  getTab(tabId: string): BibleTabState | undefined {
    return this.tabs.find(t => t.state.tabId === tabId)?.state;
  }

  /** Get a tab's navigation controller by tab ID. */
  getNavigation(tabId: string): VerseNavigationController | undefined {
    return this.tabs.find(t => t.state.tabId === tabId)?.navigation;
  }

  /** Get the number of open tabs. */
  getTabCount(): number {
    return this.tabs.length;
  }

  /** Update a tab's display mode. */
  setDisplayMode(tabId: string, mode: DisplayMode): void {
    const entry = this.tabs.find(t => t.state.tabId === tabId);
    if (entry) {
      entry.state = { ...entry.state, displayMode: mode };
    }
  }

  /** Update a tab's study options. */
  setStudyOptions(tabId: string, options: Partial<StudyModeOptions>): void {
    const entry = this.tabs.find(t => t.state.tabId === tabId);
    if (entry) {
      entry.state = {
        ...entry.state,
        studyOptions: { ...entry.state.studyOptions, ...options }
      };
    }
  }

  /** Update a tab's current passage state. */
  updateTabPassage(tabId: string, update: {
    bookNumber?: number;
    chapter?: number;
    bookName?: string;
    selectedVerseId?: number | null;
  }): void {
    const entry = this.tabs.find(t => t.state.tabId === tabId);
    if (entry) {
      entry.state = { ...entry.state, ...update };
    }
  }

  /** Change a tab's Bible version (keeps current passage). */
  changeTabVersion(tabId: string, abbreviation: string, name: string, moduleId?: number): void {
    const entry = this.tabs.find(t => t.state.tabId === tabId);
    if (entry) {
      entry.state = { ...entry.state, abbreviation, name, moduleId };
    }
  }

  /** Toggle parallel view mode. */
  toggleParallelView(): void {
    this.isParallelViewMode = !this.isParallelViewMode;
  }

  /** Set parallel Bible versions for comparison. */
  setParallelVersions(versions: string[]): void {
    this.parallelVersions = versions;
  }

  /** Get whether parallel view is active. */
  getIsParallelViewMode(): boolean {
    return this.isParallelViewMode;
  }

  /** Get the parallel version abbreviations. */
  getParallelVersions(): string[] {
    return [...this.parallelVersions];
  }

  /** Serialize all tab state for session persistence. */
  serializeState(): TabsState {
    return {
      tabs: this.tabs.map(t => ({
        ...t.state,
        navigation: t.navigation.serializeState()
      })),
      activeTabIndex: this.activeTabIndex,
      isParallelViewMode: this.isParallelViewMode,
      parallelVersions: [...this.parallelVersions]
    };
  }

  /** Restore state from a serialized snapshot. */
  restoreState(state: TabsState): void {
    this.tabs = state.tabs.map(serialized => {
      const nav = new VerseNavigationController(serialized.navigation.maxHistorySize);
      nav.restoreState(serialized.navigation);

      const { navigation: _nav, ...tabState } = serialized;
      return { state: tabState, navigation: nav };
    });
    this.activeTabIndex = state.activeTabIndex;
    this.isParallelViewMode = state.isParallelViewMode;
    this.parallelVersions = [...state.parallelVersions];
  }
}
