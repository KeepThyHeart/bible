/**
 * Platform-agnostic commentary coordination controller.
 *
 * Manages commentary panel state across all open commentaries: verse syncing,
 * tab management, pinning, and browse mode. This controller coordinates
 * commentaries collectively (not per-commentary instances).
 */

export interface CommentaryTabState {
  abbreviation: string;
  name: string;
}

export interface CommentaryCoordinationState {
  openTabs: CommentaryTabState[];
  activeTabIndex: number;
  currentVerseId: number | null;
  /**
   * A verse temporarily selected in the UI (e.g. clicked/hovered) but not yet
   * committed as the current study verse. Used to prompt the user about whether
   * to switch commentary context to the selected verse.
   */
  selectedVerseId: number | null;
  pinned: boolean;
  pinnedVerseId: number | null;
  /**
   * Per-tab browse mode, keyed by commentary abbreviation.
   * When true, the tab navigates independently of the Bible pane (free browsing).
   * When false (default), the tab stays synced to the current study verse.
   */
  browseModeByTab: Record<string, boolean>;
}

export class CommentaryCoordinationController {
  private openTabs: CommentaryTabState[] = [];
  private activeTabIndex = 0;
  private currentVerseId: number | null = null;
  private selectedVerseId: number | null = null;
  private pinned = false;
  private pinnedVerseId: number | null = null;
  private pinnedCommentaryId: string | null = null;
  private browseModeByTab = new Map<string, boolean>();

  /** Get the verse ID that commentary should display for. */
  getEffectiveVerseId(): number | null {
    return this.pinned ? this.pinnedVerseId : this.currentVerseId;
  }

  /**
   * Sync commentary to a new Bible verse.
   * If pinned, the effective verse doesn't change.
   * Returns the verse ID that should actually be used.
   */
  syncToVerse(verseId: number): number | null {
    this.currentVerseId = verseId;
    return this.getEffectiveVerseId();
  }

  /**
   * Pin the commentary to the current verse.
   * @param commentaryId Optional - pin only a specific commentary tab.
   *   When omitted, pinning applies to all commentary tabs.
   */
  pin(commentaryId?: string): void {
    this.pinned = true;
    this.pinnedVerseId = this.currentVerseId;
    this.pinnedCommentaryId = commentaryId ?? null;
  }

  /**
   * Unpin the commentary, resuming sync with Bible navigation.
   * @param commentaryId Optional - unpin only a specific commentary tab.
   */
  unpin(commentaryId?: string): void {
    if (commentaryId && this.pinnedCommentaryId !== commentaryId) return;
    this.pinned = false;
    this.pinnedVerseId = null;
    this.pinnedCommentaryId = null;
  }

  /** Toggle pin state. */
  togglePin(commentaryId?: string): void {
    if (this.pinned) {
      this.unpin(commentaryId);
    } else {
      this.pin(commentaryId);
    }
  }

  /** Whether commentary is currently pinned. */
  isPinned(): boolean {
    return this.pinned;
  }

  /**
   * Open a commentary tab. If already open, switches to it.
   * Returns the index of the tab.
   */
  openTab(abbreviation: string, name: string): number {
    const existing = this.openTabs.findIndex(t => t.abbreviation === abbreviation);
    if (existing !== -1) {
      this.activeTabIndex = existing;
      return existing;
    }

    this.openTabs.push({ abbreviation, name });
    this.activeTabIndex = this.openTabs.length - 1;
    return this.activeTabIndex;
  }

  /** Close a commentary tab by abbreviation. Returns true if found. */
  closeTab(abbreviation: string): boolean {
    const index = this.openTabs.findIndex(t => t.abbreviation === abbreviation);
    if (index === -1) return false;

    this.openTabs.splice(index, 1);
    this.browseModeByTab.delete(abbreviation);

    if (this.openTabs.length === 0) {
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
    if (index < 0 || index >= this.openTabs.length) return false;
    this.activeTabIndex = index;
    return true;
  }

  /** Reorder tabs. */
  reorderTabs(sourceIndex: number, destinationIndex: number): boolean {
    if (sourceIndex < 0 || sourceIndex >= this.openTabs.length ||
        destinationIndex < 0 || destinationIndex >= this.openTabs.length) {
      return false;
    }

    const [moved] = this.openTabs.splice(sourceIndex, 1);
    this.openTabs.splice(destinationIndex, 0, moved);

    if (this.activeTabIndex === sourceIndex) {
      this.activeTabIndex = destinationIndex;
    } else if (sourceIndex < this.activeTabIndex && destinationIndex >= this.activeTabIndex) {
      this.activeTabIndex--;
    } else if (sourceIndex > this.activeTabIndex && destinationIndex <= this.activeTabIndex) {
      this.activeTabIndex++;
    }

    return true;
  }

  /** Get the active tab state. */
  getActiveTab(): CommentaryTabState | undefined {
    return this.openTabs[this.activeTabIndex];
  }

  /** Get the active tab index. */
  getActiveTabIndex(): number {
    return this.activeTabIndex;
  }

  /** Get all open tabs. */
  getAllTabs(): CommentaryTabState[] {
    return [...this.openTabs];
  }

  /** Set browse mode for a tab. */
  setBrowseMode(abbreviation: string, enabled: boolean): void {
    this.browseModeByTab.set(abbreviation, enabled);
  }

  /** Get browse mode for a tab. */
  getBrowseMode(abbreviation: string): boolean {
    return this.browseModeByTab.get(abbreviation) ?? false;
  }

  /** Serialize state for session persistence. */
  serializeState(): CommentaryCoordinationState {
    const browseModeObj: Record<string, boolean> = {};
    this.browseModeByTab.forEach((v, k) => { browseModeObj[k] = v; });

    return {
      openTabs: [...this.openTabs],
      activeTabIndex: this.activeTabIndex,
      currentVerseId: this.currentVerseId,
      selectedVerseId: this.selectedVerseId,
      pinned: this.pinned,
      pinnedVerseId: this.pinnedVerseId,
      browseModeByTab: browseModeObj
    };
  }

  /** Restore state from a serialized snapshot. */
  restoreState(state: CommentaryCoordinationState): void {
    this.openTabs = [...state.openTabs];
    this.activeTabIndex = state.activeTabIndex;
    this.currentVerseId = state.currentVerseId;
    this.selectedVerseId = state.selectedVerseId;
    this.pinned = state.pinned;
    this.pinnedVerseId = state.pinnedVerseId;
    this.browseModeByTab.clear();
    for (const [k, v] of Object.entries(state.browseModeByTab)) {
      this.browseModeByTab.set(k, v);
    }
  }
}
