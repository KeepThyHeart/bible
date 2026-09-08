/**
 * Type-safe wrapper for Electron IPC calls
 * Ensures window.electron is available and provides clean API
 */

import type { ElectronAPI } from '../../../electron/preload';
import { unwrap, IpcResultError } from './ipcResult';

// Check if running in Electron
const isElectron = typeof window !== 'undefined' && window.electron !== undefined;

if (!isElectron && process.env.NODE_ENV === 'development') {
  console.warn('Electron API not available - may need to run in Electron context');
}

// Re-export the type for consumers
export type { ElectronAPI };

/**
 * Safe Electron API wrapper
 * Returns null if not in Electron context
 */
export const electronAPI = isElectron ? window.electron : null;

/**
 * Helper to ensure Electron API is available
 * Throws error if not available
 */
export function requireElectronAPI(): ElectronAPI {
  if (!electronAPI) {
    throw new Error('Electron API not available. This feature requires running in Electron.');
  }
  return electronAPI;
}

// Convenience methods for bible.
//
// Migrated to the `Result<T>` envelope convention (cleanup item 2.3a). The
// main-process handlers in `electron/ipc/bibleHandlers.ts` and
// `electron/ipc/studyHandlers.ts` now return `{ ok, value } | { ok: false, error }`.
// Each call here uses `unwrap` to resolve the envelope to its value, or throw
// an `IpcResultError` carrying the classified error code (`not_found`,
// `invalid_input`, `internal`, ...) so call sites can branch via `err.code`
// instead of parsing message strings.
export const bibleAPI = {
  async getAvailableBibles() {
    const api = requireElectronAPI();
    return unwrap(api.bible.getAvailableBibles());
  },

  async getVerse(abbreviation: string, verseId: number) {
    const api = requireElectronAPI();
    return unwrap(api.bible.getVerse(abbreviation, verseId));
  },

  async getVerses(abbreviation: string, startId: number, endId: number) {
    const api = requireElectronAPI();
    return unwrap(api.bible.getVerses(abbreviation, startId, endId));
  },

  async getChapter(abbreviation: string, bookNumber: number, chapter: number) {
    const api = requireElectronAPI();
    return unwrap(api.bible.getChapter(abbreviation, bookNumber, chapter));
  },

  async search(abbreviation: string, query: string) {
    const api = requireElectronAPI();
    return unwrap(api.bible.search(abbreviation, query));
  },

  async getBookName(bookNumber: number) {
    const api = requireElectronAPI();
    return unwrap(api.bible.getBookName(bookNumber));
  },

  async getAllBooks() {
    const api = requireElectronAPI();
    return unwrap(api.bible.getAllBooks());
  },

  // Batch method for faster initial load - returns available Bibles + default chapter in one call
  async getInitialData(defaultAbbreviation?: string, defaultBook?: number, defaultChapter?: number) {
    const api = requireElectronAPI();
    return unwrap(api.bible.getInitialData(defaultAbbreviation, defaultBook, defaultChapter));
  },

  // Study mode methods
  async getInterlinearWords(abbreviation: string, verseId: number) {
    const api = requireElectronAPI();
    return unwrap(api.bible.getInterlinearWords(abbreviation, verseId));
  },

  async getInterlinearWordsForChapter(abbreviation: string, bookNumber: number, chapter: number) {
    const api = requireElectronAPI();
    return unwrap(api.bible.getInterlinearWordsForChapter(abbreviation, bookNumber, chapter));
  },

  async hasInterlinearData(abbreviation: string) {
    const api = requireElectronAPI();
    return unwrap(api.bible.hasInterlinearData(abbreviation));
  },

  async getUserCrossReferences(username: string, verseId: number) {
    const api = requireElectronAPI();
    return unwrap(api.bible.getUserCrossReferences(username, verseId));
  },

  async createUserCrossReference(username: string, fromVerseId: number, toVerseId: number, notes?: string) {
    const api = requireElectronAPI();
    return unwrap(api.bible.createUserCrossReference(username, fromVerseId, toVerseId, notes));
  },

  async deleteUserCrossReference(username: string, userXrefId: number) {
    const api = requireElectronAPI();
    return unwrap(api.bible.deleteUserCrossReference(username, userXrefId));
  },

  async getVerseTexts(abbreviation: string, verseIds: number[]) {
    const api = requireElectronAPI();
    return unwrap(api.bible.getVerseTexts(abbreviation, verseIds));
  }
};

// Convenience methods for commentary.
//
// Migrated to the `Result<T>` envelope convention (cleanup item 2.3a). The
// main-process handlers in `electron/ipc/commentaryHandlers.ts` now return
// `{ ok, value } | { ok: false, error }`. Each call here uses `unwrap` to
// resolve the envelope to its value, or throw an `IpcResultError` carrying
// the classified error code (`not_found`, `invalid_input`, `internal`, ...)
// so call sites can branch via `err.code` instead of parsing message strings.
export const commentaryAPI = {
  async getAvailableCommentaries() {
    const api = requireElectronAPI();
    return unwrap(api.commentary.getAvailableCommentaries());
  },

  async getCommentaryInfo(abbreviation: string) {
    const api = requireElectronAPI();
    return unwrap(api.commentary.getCommentaryInfo(abbreviation));
  },

  async getEntriesForVerse(abbreviation: string, verseId: number) {
    const api = requireElectronAPI();
    return unwrap(api.commentary.getEntriesForVerse(abbreviation, verseId));
  },

  async hasContentForVerse(abbreviation: string, verseId: number) {
    const api = requireElectronAPI();
    return unwrap(api.commentary.hasContentForVerse(abbreviation, verseId));
  },

  async getNextVerseWithContent(abbreviation: string, currentVerseId: number) {
    const api = requireElectronAPI();
    return unwrap(api.commentary.getNextVerseWithContent(abbreviation, currentVerseId));
  },

  async getPreviousVerseWithContent(abbreviation: string, currentVerseId: number) {
    const api = requireElectronAPI();
    return unwrap(api.commentary.getPreviousVerseWithContent(abbreviation, currentVerseId));
  },

  async getAllEntrySummaries(abbreviation: string) {
    const api = requireElectronAPI();
    return unwrap(api.commentary.getAllEntrySummaries(abbreviation));
  },

  // Batch method for session restore - loads everything in one IPC call
  async batchRestoreSession(request: {
    abbreviations: string[];
    verseId: number;
    browseModeByTab?: Record<string, boolean>;
  }) {
    const api = requireElectronAPI();
    return unwrap(api.commentary.batchRestoreSession(request));
  }
};

// Convenience methods for dictionary.
//
// Migrated to the `Result<T>` envelope convention (cleanup item 2.3a). The
// main-process handlers in `electron/ipc/dictionaryHandlers.ts` now return
// `{ ok, value } | { ok: false, error }`. Each call here uses `unwrap` to
// resolve the envelope to its value, or throw an `IpcResultError` carrying
// the classified error code (`not_found`, `invalid_input`, `internal`, ...)
// so call sites can branch via `err.code` instead of parsing message strings.
export const dictionaryAPI = {
  async getAvailableDictionaries() {
    const api = requireElectronAPI();
    return unwrap(api.dictionary.getAvailableDictionaries());
  },

  async getDictionaryInfo(abbreviation: string) {
    const api = requireElectronAPI();
    return unwrap(api.dictionary.getDictionaryInfo(abbreviation));
  },

  async getEntry(abbreviation: string, entryId: number) {
    const api = requireElectronAPI();
    return unwrap(api.dictionary.getEntry(abbreviation, entryId));
  },

  async getEntryByKey(abbreviation: string, entryKey: string) {
    const api = requireElectronAPI();
    return unwrap(api.dictionary.getEntryByKey(abbreviation, entryKey));
  },

  async searchEntries(abbreviation: string, query: string, limit?: number) {
    const api = requireElectronAPI();
    return unwrap(api.dictionary.searchEntries(abbreviation, query, limit));
  },

  async getAllEntries(abbreviation: string, limit?: number, offset?: number) {
    const api = requireElectronAPI();
    return unwrap(api.dictionary.getAllEntries(abbreviation, limit, offset));
  },

  async getOccurrences(abbreviation: string, entryKey: string) {
    const api = requireElectronAPI();
    return unwrap(api.dictionary.getOccurrences(abbreviation, entryKey));
  },

  async getOccurrencesForVerse(abbreviation: string, verseId: number) {
    const api = requireElectronAPI();
    return unwrap(api.dictionary.getOccurrencesForVerse(abbreviation, verseId));
  }
};

// Convenience methods for books.
//
// Migrated to the `Result<T>` envelope convention (cleanup item 2.3a). The
// main-process handlers in `electron/ipc/bookHandlers.ts` now return
// `{ ok, value } | { ok: false, error }`. Each call here uses `unwrap` to
// resolve the envelope to its value, or throw an `IpcResultError` carrying
// the classified error code (`not_found`, `invalid_input`, `internal`, ...)
// so call sites can branch via `err.code` instead of parsing message strings.
export const bookAPI = {
  async getAvailableBooks() {
    const api = requireElectronAPI();
    return unwrap(api.book.getAvailableBooks());
  },

  async getBookInfo(abbreviation: string) {
    const api = requireElectronAPI();
    return unwrap(api.book.getBookInfo(abbreviation));
  },

  async getSection(abbreviation: string, sectionId: number) {
    const api = requireElectronAPI();
    return unwrap(api.book.getSection(abbreviation, sectionId));
  },

  async getTopLevelSections(abbreviation: string) {
    const api = requireElectronAPI();
    return unwrap(api.book.getTopLevelSections(abbreviation));
  },

  async getSectionsByParent(abbreviation: string, parentSectionId: number) {
    const api = requireElectronAPI();
    return unwrap(api.book.getSectionsByParent(abbreviation, parentSectionId));
  },

  async getAllSectionSummaries(abbreviation: string) {
    const api = requireElectronAPI();
    return unwrap(api.book.getAllSectionSummaries(abbreviation));
  },

  async getNextSection(abbreviation: string, currentSectionId: number) {
    const api = requireElectronAPI();
    return unwrap(api.book.getNextSection(abbreviation, currentSectionId));
  },

  async getPreviousSection(abbreviation: string, currentSectionId: number) {
    const api = requireElectronAPI();
    return unwrap(api.book.getPreviousSection(abbreviation, currentSectionId));
  },

  async getParentSection(abbreviation: string, currentSectionId: number) {
    const api = requireElectronAPI();
    return unwrap(api.book.getParentSection(abbreviation, currentSectionId));
  },

  async searchSections(abbreviation: string, query: string, limit?: number) {
    const api = requireElectronAPI();
    return unwrap(api.book.searchSections(abbreviation, query, limit));
  },

  async getScriptureReferences(abbreviation: string, sectionId: number) {
    const api = requireElectronAPI();
    return unwrap(api.book.getScriptureReferences(abbreviation, sectionId));
  },

  async getSectionsReferencingVerse(abbreviation: string, verseId: number) {
    const api = requireElectronAPI();
    return unwrap(api.book.getSectionsReferencingVerse(abbreviation, verseId));
  }
};

// Convenience methods for search.
//
// Migrated to the `Result<T>` envelope convention (cleanup item 2.3a). The
// main-process handlers in `electron/ipc/searchHandlers.ts` now return
// `{ ok, value } | { ok: false, error }`. Each call here uses `unwrap` so
// downstream callers (`useSearchStore.ts`) keep working unchanged: a
// `not_found` / `unavailable` / `internal` envelope becomes a thrown
// `IpcResultError`, which the existing try/catch blocks already handle.
//
// `loadSavedSearch` keeps its prior null-on-missing contract: if the handler
// returns `not_found`, this wrapper resolves to `null` instead of throwing,
// so call sites that do `if (savedSearch) { ... }` keep working.
export const searchAPI = {
  async performSearch(query: string, options: any) {
    const api = requireElectronAPI();
    return unwrap(api.search.performSearch(query, options));
  },

  async getSavedSearches() {
    const api = requireElectronAPI();
    return unwrap(api.search.getSavedSearches());
  },

  async saveSearch(name: string, query: string, searchType: string, scope: any, options: any) {
    const api = requireElectronAPI();
    return unwrap(api.search.saveSearch(name, query, searchType, scope, options));
  },

  async loadSavedSearch(searchId: number) {
    const api = requireElectronAPI();
    try {
      return await unwrap(api.search.loadSavedSearch(searchId));
    } catch (err) {
      if (err instanceof IpcResultError && err.code === 'not_found') {
        return null;
      }
      throw err;
    }
  },

  async deleteSavedSearch(searchId: number) {
    const api = requireElectronAPI();
    return unwrap(api.search.deleteSavedSearch(searchId));
  },

  async getIndexStatus(modules: string[]) {
    const api = requireElectronAPI();
    return unwrap(api.search.getIndexStatus(modules));
  },

  async buildIndex(modules: string[], onProgress?: (progress: any) => void) {
    const api = requireElectronAPI();
    return unwrap(api.search.buildIndex(modules, onProgress));
  },

  async semanticAvailable() {
    const api = requireElectronAPI();
    return unwrap(api.search.semanticAvailable());
  },

  async semanticSearch(query: string, options?: { maxResults?: number; levels?: string[] }) {
    const api = requireElectronAPI();
    return unwrap(api.search.semanticSearch(query, options));
  }
};

/**
 * Optional feature packs (semantic search). Same `unwrap` chokepoint as every
 * other API here: handlers reply with a `Result<T>` envelope and failures
 * surface as thrown `IpcResultError`s.
 *
 * `install` resolves as soon as the download *starts* - the pack is hundreds of
 * megabytes, so progress is read by polling `getStatus`.
 */
export const featurePackAPI = {
  async listAvailable() {
    const api = requireElectronAPI();
    return unwrap(api.featurePacks.listAvailable());
  },

  async getStatus() {
    const api = requireElectronAPI();
    return unwrap(api.featurePacks.getStatus());
  },

  async install(packId: string) {
    const api = requireElectronAPI();
    return unwrap(api.featurePacks.install(packId));
  },

  /**
   * Open a native picker and install the chosen package. Resolves to `null`
   * when the user cancels the picker - that is not an error.
   */
  async installFromFile(kind: 'file' | 'folder') {
    const api = requireElectronAPI();
    return unwrap(api.featurePacks.installFromFile(kind));
  },

  async cancel() {
    const api = requireElectronAPI();
    return unwrap(api.featurePacks.cancel());
  },

  async uninstall() {
    const api = requireElectronAPI();
    return unwrap(api.featurePacks.uninstall());
  },
};

// Convenience methods for sessions.
//
// All session IPC handlers were migrated to `ipcHandler` (item 2.3a - Apr 14
// cleanup), so the raw bridge in preload returns `Result<T>` envelopes.
// `sessionAPI` is the single chokepoint where we `unwrap()` those envelopes
// so downstream call sites (`useSessionStore`, etc.) keep working unchanged.
// Callers that want to branch on classified errors can catch
// `IpcResultError` and check `err.code` (e.g. `'not_found'`,
// `'invalid_input'`, `'unavailable'`). `unwrap` is imported at the top of
// this file alongside the other API wrappers.

export const sessionAPI = {
  async getAll() {
    const api = requireElectronAPI();
    return unwrap(api.session.getAll());
  },

  async load(sessionId: number) {
    const api = requireElectronAPI();
    return unwrap(api.session.load(sessionId));
  },

  async getOrCreateAutosave() {
    const api = requireElectronAPI();
    return unwrap(api.session.getOrCreateAutosave());
  },

  async create(data: { name: string; description?: string; sessionData: any; isDefault?: boolean }) {
    const api = requireElectronAPI();
    return unwrap(api.session.create(data));
  },

  async update(sessionId: number, updates: { name?: string; description?: string; sessionData?: any; isDefault?: boolean }) {
    const api = requireElectronAPI();
    return unwrap(api.session.update(sessionId, updates));
  },

  async delete(sessionId: number) {
    const api = requireElectronAPI();
    return unwrap(api.session.delete(sessionId));
  },

  async setAsDefault(sessionId: number) {
    const api = requireElectronAPI();
    return unwrap(api.session.setAsDefault(sessionId));
  },

  async getDefault() {
    const api = requireElectronAPI();
    return unwrap(api.session.getDefault());
  },

  async getRecent(limit?: number) {
    const api = requireElectronAPI();
    return unwrap(api.session.getRecent(limit));
  }
};
