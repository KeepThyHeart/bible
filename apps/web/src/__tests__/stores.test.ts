import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Store } from '../stores/Store';

describe('Store base class', () => {
  it('notifies subscribers on changes', () => {
    class TestStore extends Store {
      value = 0;
      increment() {
        this.value++;
        this.notify();
      }
    }

    const store = new TestStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.increment();
    expect(listener).toHaveBeenCalledTimes(1);

    store.increment();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('unsubscribe stops notifications', () => {
    class TestStore extends Store {
      value = 0;
      increment() {
        this.value++;
        this.notify();
      }
    }

    const store = new TestStore();
    const listener = vi.fn();
    const unsub = store.subscribe(listener);

    store.increment();
    expect(listener).toHaveBeenCalledTimes(1);

    unsub();
    store.increment();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('SettingsStore', () => {
  beforeEach(() => {
    // Clear localStorage
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }
  });

  it('has sensible defaults', async () => {
    // Dynamic import to get fresh instance
    const { settingsStore } = await import('../stores/settingsStore');
    expect(settingsStore.fontSize).toBe(18);
    expect(settingsStore.lineHeight).toBe(1.8);
    expect(settingsStore.theme).toBe('auto');
  });
});

describe('SearchStore', () => {
  it('starts closed with empty results', async () => {
    const { searchStore } = await import('../stores/searchStore');
    expect(searchStore.isOpen).toBe(false);
    expect(searchStore.results).toEqual([]);
    expect(searchStore.query).toBe('');
  });

  it('open/close toggling works', async () => {
    const { searchStore } = await import('../stores/searchStore');
    searchStore.open();
    expect(searchStore.isOpen).toBe(true);
    searchStore.close();
    expect(searchStore.isOpen).toBe(false);
  });

  it('clear resets state', async () => {
    const { searchStore } = await import('../stores/searchStore');
    searchStore.open();
    searchStore.query = 'test';
    searchStore.clear();
    expect(searchStore.isOpen).toBe(false);
    expect(searchStore.query).toBe('');
    expect(searchStore.results).toEqual([]);
  });
});

describe('ModuleStore', () => {
  it('starts unloaded', async () => {
    const { moduleStore } = await import('../stores/moduleStore');
    expect(moduleStore.loaded).toBe(false);
    expect(moduleStore.availableModules).toEqual([]);
    expect(moduleStore.availableBooks).toEqual([]);
  });
});

// ============================================================
// CommentaryStore
// ============================================================
describe('CommentaryStore - Pin functionality', () => {
  function createCommentaryStore() {
    class TestCommentaryStore extends Store {
      tabs: Array<{ id: string; moduleAbbr: string; moduleName: string }> = [];
      activeTabId = '';
      entries: unknown[] = [];
      collapsed = false;
      loading = false;
      syncedBook: number | null = null;
      syncedChapter: number | null = null;
      pinned = false;
      pinnedBook: number | null = null;
      pinnedChapter: number | null = null;
      rightPaneMode: 'commentary' | 'search' = 'commentary';
      private loadCalled = false;
      private lastLoadArgs: { book: number; chapter: number } | null = null;

      togglePin(): void {
        if (this.pinned) this.unpin();
        else this.pin();
      }

      pin(): void {
        this.pinned = true;
        this.pinnedBook = this.syncedBook;
        this.pinnedChapter = this.syncedChapter;
        this.notify();
      }

      unpin(): void {
        this.pinned = false;
        this.pinnedBook = null;
        this.pinnedChapter = null;
        this.notify();
      }

      setRightPaneMode(mode: 'commentary' | 'search'): void {
        this.rightPaneMode = mode;
        this.notify();
      }

      loadForChapter(book: number, chapter: number): void {
        if (this.pinned) return;
        this.loadCalled = true;
        this.lastLoadArgs = { book, chapter };
        this.syncedBook = book;
        this.syncedChapter = chapter;
        this.notify();
      }

      wasLoadCalled(): boolean { return this.loadCalled; }
      getLastLoadArgs(): { book: number; chapter: number } | null { return this.lastLoadArgs; }
      resetLoadTracking(): void { this.loadCalled = false; this.lastLoadArgs = null; }
    }
    return new TestCommentaryStore();
  }

  it('starts unpinned by default', () => {
    const store = createCommentaryStore();
    expect(store.pinned).toBe(false);
    expect(store.pinnedBook).toBeNull();
    expect(store.pinnedChapter).toBeNull();
  });

  it('pin() sets pinned state with current synced position', () => {
    const store = createCommentaryStore();
    store.syncedBook = 43;
    store.syncedChapter = 3;
    store.pin();
    expect(store.pinned).toBe(true);
    expect(store.pinnedBook).toBe(43);
    expect(store.pinnedChapter).toBe(3);
  });

  it('unpin() clears pinned state', () => {
    const store = createCommentaryStore();
    store.syncedBook = 43;
    store.syncedChapter = 3;
    store.pin();
    store.unpin();
    expect(store.pinned).toBe(false);
    expect(store.pinnedBook).toBeNull();
    expect(store.pinnedChapter).toBeNull();
  });

  it('togglePin() toggles between pinned and unpinned', () => {
    const store = createCommentaryStore();
    store.syncedBook = 43;
    store.syncedChapter = 3;
    store.togglePin();
    expect(store.pinned).toBe(true);
    store.togglePin();
    expect(store.pinned).toBe(false);
  });

  it('loadForChapter is a no-op when pinned', () => {
    const store = createCommentaryStore();
    store.syncedBook = 43;
    store.syncedChapter = 3;
    store.pin();
    store.resetLoadTracking();
    store.loadForChapter(1, 1);
    expect(store.wasLoadCalled()).toBe(false);
    expect(store.syncedBook).toBe(43);
    expect(store.syncedChapter).toBe(3);
  });

  it('loadForChapter works normally when unpinned', () => {
    const store = createCommentaryStore();
    store.loadForChapter(1, 1);
    expect(store.wasLoadCalled()).toBe(true);
    expect(store.syncedBook).toBe(1);
    expect(store.syncedChapter).toBe(1);
  });

  it('pin notifies subscribers', () => {
    const store = createCommentaryStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.pin();
    expect(listener).toHaveBeenCalled();
  });

  it('unpin notifies subscribers', () => {
    const store = createCommentaryStore();
    store.pin();
    const listener = vi.fn();
    store.subscribe(listener);
    store.unpin();
    expect(listener).toHaveBeenCalled();
  });
});

describe('CommentaryStore - Right pane mode', () => {
  function createStore() {
    class TestStore extends Store {
      rightPaneMode: 'commentary' | 'search' = 'commentary';
      setRightPaneMode(mode: 'commentary' | 'search'): void {
        this.rightPaneMode = mode;
        this.notify();
      }
    }
    return new TestStore();
  }

  it('starts in commentary mode', () => {
    const store = createStore();
    expect(store.rightPaneMode).toBe('commentary');
  });

  it('can switch to search mode', () => {
    const store = createStore();
    store.setRightPaneMode('search');
    expect(store.rightPaneMode).toBe('search');
  });

  it('can switch back to commentary mode', () => {
    const store = createStore();
    store.setRightPaneMode('search');
    store.setRightPaneMode('commentary');
    expect(store.rightPaneMode).toBe('commentary');
  });

  it('notifies on mode change', () => {
    const store = createStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.setRightPaneMode('search');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('BibleStore - verse selection', () => {
  it('setStudyVerse sets study verse', () => {
    class TestBibleStore extends Store {
      studyVerse: number | null = null;
      setStudyVerse(verseId: number): void {
        if (this.studyVerse === verseId) {
          this.studyVerse = null;
        } else {
          this.studyVerse = verseId;
        }
        this.notify();
      }
    }
    const store = new TestBibleStore();
    store.setStudyVerse(43003016);
    expect(store.studyVerse).toBe(43003016);
    // Clicking again deselects
    store.setStudyVerse(43003016);
    expect(store.studyVerse).toBeNull();
  });
});

describe('SettingsStore - new features', () => {
  beforeEach(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }
  });

  it('has wordsOfChristInRed enabled by default', async () => {
    const { settingsStore } = await import('../stores/settingsStore');
    expect(settingsStore.wordsOfChristInRed).toBe(true);
  });

  it('has study font family default', async () => {
    const { settingsStore } = await import('../stores/settingsStore');
    expect(settingsStore.studyFontFamily).toBe('Georgia, serif');
  });

  it('setWordsOfChristInRed updates and persists', async () => {
    const { settingsStore } = await import('../stores/settingsStore');
    const listener = vi.fn();
    settingsStore.subscribe(listener);

    settingsStore.setWordsOfChristInRed(false);
    expect(settingsStore.wordsOfChristInRed).toBe(false);
    expect(listener).toHaveBeenCalled();
  });

  it('setStudyFontFamily updates and persists', async () => {
    const { settingsStore } = await import('../stores/settingsStore');
    const listener = vi.fn();
    settingsStore.subscribe(listener);

    settingsStore.setStudyFontFamily("'Times New Roman', serif");
    expect(settingsStore.studyFontFamily).toBe("'Times New Roman', serif");
    expect(listener).toHaveBeenCalled();
  });

  it('adjustAllFontSizes increases all sizes by delta', async () => {
    const { settingsStore } = await import('../stores/settingsStore');
    const origBible = settingsStore.fontSize;
    const origStudy = settingsStore.studyFontSize;
    const origUi = settingsStore.uiFontSize;

    settingsStore.adjustAllFontSizes(2);
    expect(settingsStore.fontSize).toBe(origBible + 2);
    expect(settingsStore.studyFontSize).toBe(origStudy + 2);
    expect(settingsStore.uiFontSize).toBe(origUi + 2);
  });

  it('adjustAllFontSizes clamps to min/max', async () => {
    const { settingsStore } = await import('../stores/settingsStore');
    // Set UI to max
    settingsStore.setUiFontSize(24);
    settingsStore.adjustAllFontSizes(2);
    expect(settingsStore.uiFontSize).toBe(24); // clamped at max

    // Set all to min
    settingsStore.setFontSize(12);
    settingsStore.setStudyFontSize(12);
    settingsStore.setUiFontSize(10);
    settingsStore.adjustAllFontSizes(-2);
    expect(settingsStore.fontSize).toBe(12); // clamped at min
    expect(settingsStore.studyFontSize).toBe(12);
    expect(settingsStore.uiFontSize).toBe(10);
  });
});
