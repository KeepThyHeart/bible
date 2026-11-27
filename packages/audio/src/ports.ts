/**
 * What the audio store needs from the app it runs in. Each app adapts its own
 * reader to these (web: `bibleStore` tabs; desktop: Bible panes), so the store
 * holds no app code.
 */

/** A place the Bible is shown that audio can read from and follow (a web tab, a desktop Bible pane). */
export interface AudioReaderTab {
  id: string;
  moduleAbbr: string;
  book: number | null;
  chapter: number | null;
  loading: boolean;
  /** The chapter's verses as shown (only `verse` is read). */
  verses: ReadonlyArray<{ verse: number }>;
  /** The verse the Study panes follow, as a verse id (`book * 1e6 + chapter * 1e3 + verse`). */
  studyVerse?: number | null;
}

export interface AudioReaderPort {
  /** Called on any change to any tab (navigation, translation, closing, loading). */
  subscribe(listener: () => void): () => void;
  tab(id: string): AudioReaderTab | undefined;
  /** The tab Play acts on when none is named (the active / focused one). */
  activeTab(): AudioReaderTab | undefined;
  /** Start of the reader's own selection in this tab, as a verse id, or null. */
  selectionStart(tabId: string): number | null;
  /**
   * Turn the page of one tab to follow the reading: no selection change, no history entry,
   * and the Study / Commentary panes are not moved.
   */
  followTo(tabId: string, book: number, chapter: number): void | Promise<void>;
  /** Reading stopped here: make it the tab's selected verse. No scroll jump, no history entry. */
  markStopped?(tabId: string, verseId: number): void;
  /** Bring the tab to the front (activate its pane / switch to the web tab). */
  reveal?(tabId: string): void;
}

export interface AudioModulesPort {
  /** Called when the module list arrives or changes (what can play may change). */
  subscribe(listener: () => void): () => void;
  /** BCP-47 language of a translation, '' while unknown. */
  languageOf(moduleAbbr: string): string;
}

/** Where preferences are kept (`localStorage` by default). */
export type AudioPrefsStorage = Pick<Storage, 'getItem' | 'setItem'>;

export interface AudioStoreHost {
  reader: AudioReaderPort;
  modules: AudioModulesPort;
}
