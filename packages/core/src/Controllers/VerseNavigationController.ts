/**
 * Platform-agnostic verse navigation history controller.
 *
 * Manages a browser-style history stack for Bible verse navigation.
 * Extracted from the desktop Zustand store so any UI framework can use it.
 */

export interface HistoryEntry {
  verseId: number;
  bookNumber: number;
  chapter: number;
  bookName: string;
  scrollTop?: number;
}

export interface NavigationState {
  history: HistoryEntry[];
  historyIndex: number;
  maxHistorySize: number;
}

export class VerseNavigationController {
  private history: HistoryEntry[] = [];
  private historyIndex = -1;
  private maxHistorySize: number;

  constructor(maxHistorySize = 10) {
    this.maxHistorySize = maxHistorySize;
  }

  /** Whether there is a previous entry to navigate to. */
  canGoBack(): boolean {
    return this.historyIndex > 0;
  }

  /** Whether there is a forward entry to navigate to. */
  canGoForward(): boolean {
    return this.historyIndex < this.history.length - 1;
  }

  /**
   * Move back one entry. Returns the entry to navigate to, or null if at the start.
   * The caller is responsible for actually loading the chapter/verse.
   */
  goBack(): HistoryEntry | null {
    if (!this.canGoBack()) return null;
    this.historyIndex--;
    return this.history[this.historyIndex];
  }

  /**
   * Move forward one entry. Returns the entry to navigate to, or null if at the end.
   */
  goForward(): HistoryEntry | null {
    if (!this.canGoForward()) return null;
    this.historyIndex++;
    return this.history[this.historyIndex];
  }

  /**
   * Jump to a specific history index. Returns the entry, or null if out of range.
   */
  navigateToIndex(index: number): HistoryEntry | null {
    if (index < 0 || index >= this.history.length) return null;
    this.historyIndex = index;
    return this.history[index];
  }

  /**
   * Add a navigation entry. Truncates forward history (browser behavior),
   * deduplicates by chapter, and caps at maxHistorySize.
   */
  addEntry(entry: HistoryEntry): void {
    // Truncate forward entries
    let truncated = this.history.slice(0, this.historyIndex + 1);

    // Remove existing entry for the same chapter (each chapter appears once)
    truncated = truncated.filter(
      h => !(h.bookNumber === entry.bookNumber && h.chapter === entry.chapter)
    );

    truncated.push(entry);

    // Cap at max size
    this.history = truncated.slice(-this.maxHistorySize);
    this.historyIndex = this.history.length - 1;
  }

  /**
   * Save scroll position for the current history entry.
   * Future enhancement: replace scrollTop with a ScrollPosition class
   * containing { scrollTop: number, anchorVerseId?: number } to preserve
   * position across screen resizes.
   */
  saveScrollPosition(scrollTop: number): void {
    if (this.historyIndex >= 0 && this.historyIndex < this.history.length) {
      this.history[this.historyIndex] = {
        ...this.history[this.historyIndex],
        scrollTop
      };
    }
  }

  /** Get the current history entry, or null if empty. */
  getCurrentEntry(): HistoryEntry | null {
    if (this.historyIndex >= 0 && this.historyIndex < this.history.length) {
      return this.history[this.historyIndex];
    }
    return null;
  }

  /** Get the full history stack (read-only copy). */
  getHistory(): HistoryEntry[] {
    return [...this.history];
  }

  /** Get the current index in the history stack. */
  getHistoryIndex(): number {
    return this.historyIndex;
  }

  /** Serialize state for session persistence. */
  serializeState(): NavigationState {
    return {
      history: [...this.history],
      historyIndex: this.historyIndex,
      maxHistorySize: this.maxHistorySize
    };
  }

  /** Restore state from a serialized snapshot. */
  restoreState(state: NavigationState): void {
    this.history = [...state.history];
    this.historyIndex = state.historyIndex;
    this.maxHistorySize = state.maxHistorySize;
  }
}
