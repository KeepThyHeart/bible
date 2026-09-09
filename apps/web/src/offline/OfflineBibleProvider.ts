/**
 * Offline-aware Bible data provider.
 *
 * When a module's DB is already open in the worker, queries it locally (instant).
 * When not yet open, serves from the server API while opening the DB in the
 * background so the next navigation is local. Transparent to consumers — same
 * IBibleDataProvider interface.
 */

import type { IBibleDataProvider, BatchVerseTexts, VotdData } from '../providers/interfaces';
import type { ChapterData, VerseData, BookTopicsData } from '../types';
import type { BibleWorkerProxy } from './BibleWorkerProxy';
import { offlineStore } from '../stores/offlineStore';

export class OfflineBibleProvider implements IBibleDataProvider {
  private loadingModules = new Set<string>();

  /**
   * Per module, whether the server ever reported interlinear data.
   *
   * The downloaded lite DB carries only module_info/bible_verse, so a local
   * read always answers `hasInterlinearData: false`. Without this the flag
   * flipped to false on the first chapter served locally, even though
   * /api/interlinear still serves that module's words from the full DB.
   */
  private serverHasInterlinear = new Map<string, boolean>();

  constructor(
    private server: IBibleDataProvider,
    private workerProxy: BibleWorkerProxy,
  ) {}

  /**
   * True once the module's database is open in the worker — the same condition
   * `getChapter` uses to take its local fast path. "Downloaded" is deliberately
   * not enough: a downloaded-but-unopened module still goes to the server.
   */
  isServedLocally(module: string): boolean {
    return this.workerProxy.isModuleOpen(module);
  }

  async getChapter(module: string, book: number, chapter: number): Promise<ChapterData> {
    // Fast path: DB already open in the worker — query locally
    if (this.workerProxy.isModuleOpen(module)) {
      try {
        const t0 = performance.now();
        const data = await this.workerProxy.getChapter(module, book, chapter);
        offlineStore.touchModule(module);
        console.debug(`[OfflineBible] LOCAL ${module} ${book}/${chapter}: ${(performance.now()-t0).toFixed(1)}ms`);
        return this.withKnownInterlinear(module, data);
      } catch (err) {
        console.warn(`[OfflineBible] Local read failed for ${module}, falling back to server:`, err);
      }
    }

    // Module downloaded but not yet open — start opening in the background.
    const isDownloaded = offlineStore.isModuleDownloaded(module);
    if (isDownloaded) {
      this.openDbInBackground(module);
    }

    // Try the server first (faster than waiting for DB open on first load).
    // If the server fails and we have a local copy, wait for the DB to open
    // and query locally — graceful degradation when the server is down.
    try {
      const t0 = performance.now();
      const data = await this.server.getChapter(module, book, chapter);
      this.serverHasInterlinear.set(module, data.hasInterlinearData);
      console.debug(`[OfflineBible] SERVER ${module} ${book}/${chapter}: ${(performance.now()-t0).toFixed(1)}ms`);
      return data;
    } catch (serverErr) {
      if (!isDownloaded) throw serverErr;

      console.warn(`[OfflineBible] Server failed for ${module}, waiting for local DB:`, serverErr);
      try {
        await this.workerProxy.openDb(module);
        const t0 = performance.now();
        const data = await this.workerProxy.getChapter(module, book, chapter);
        offlineStore.touchModule(module);
        console.debug(`[OfflineBible] LOCAL-FALLBACK ${module} ${book}/${chapter}: ${(performance.now()-t0).toFixed(1)}ms`);
        return this.withKnownInterlinear(module, data);
      } catch (localErr) {
        // Local fallback also failed — throw the original server error
        console.error(`[OfflineBible] Local fallback also failed for ${module}:`, localErr);
        throw serverErr;
      }
    }
  }

  async getVerse(module: string, verseId: number): Promise<VerseData> {
    if (this.workerProxy.isModuleOpen(module)) {
      try {
        const data = await this.workerProxy.getVerse(module, verseId);
        offlineStore.touchModule(module);
        return data;
      } catch (err) {
        console.warn(`[OfflineBible] Local verse read failed for ${module}, falling back to server:`, err);
      }
    }

    const isDownloaded = offlineStore.isModuleDownloaded(module);
    if (isDownloaded) {
      this.openDbInBackground(module);
    }

    try {
      return await this.server.getVerse(module, verseId);
    } catch (serverErr) {
      if (!isDownloaded) throw serverErr;

      console.warn(`[OfflineBible] Server failed for verse ${verseId}, waiting for local DB:`, serverErr);
      try {
        await this.workerProxy.openDb(module);
        const data = await this.workerProxy.getVerse(module, verseId);
        offlineStore.touchModule(module);
        return data;
      } catch (localErr) {
        console.error(`[OfflineBible] Local verse fallback also failed for ${module}:`, localErr);
        throw serverErr;
      }
    }
  }

  /** Re-assert interlinear availability the lite DB cannot see for itself. */
  private withKnownInterlinear(module: string, data: ChapterData): ChapterData {
    if (data.hasInterlinearData) return data;
    if (!this.serverHasInterlinear.get(module)) return data;
    return { ...data, hasInterlinearData: true };
  }

  getVerseTexts(module: string, verseIds: number[]): Promise<BatchVerseTexts> {
    // Batch fetch — always delegate to server for now (worker proxy doesn't support batch yet)
    return this.server.getVerseTexts(module, verseIds);
  }

  // These are not stored in module DBs — always delegate to server
  getBookTopics(book: number): Promise<BookTopicsData> {
    return this.server.getBookTopics(book);
  }

  getVerseOfTheDay(): Promise<VotdData> {
    return this.server.getVerseOfTheDay();
  }

  /**
   * Eagerly open the worker DB for every downloaded module on app boot, so the
   * very first Bible request after launch can hit the fast local path instead
   * of waiting on the server. Fire-and-forget; the lazy path in getChapter/
   * getVerse remains the safety net if this is never called or fails.
   */
  preload(): Promise<void> {
    const modules = offlineStore.downloadedModules.map(m => m.abbreviation);
    for (const module of modules) {
      this.openDbInBackground(module);
    }
    return Promise.resolve();
  }

  /**
   * Open a module DB in the worker in the background (fire-and-forget).
   * wa-sqlite opens the OPFS file directly — no need to read into memory first.
   * The next getChapter/getVerse call will hit the fast local path.
   */
  private openDbInBackground(module: string): void {
    if (this.workerProxy.isModuleOpen(module)) return;
    if (this.loadingModules.has(module)) return;

    this.loadingModules.add(module);
    const t0 = performance.now();

    (async () => {
      try {
        await this.workerProxy.openDb(module);
        console.debug(`[OfflineBible] Background open ${module}: ${(performance.now()-t0).toFixed(1)}ms — next nav will be local`);
      } catch (err) {
        // OPFS file is missing (browser evicted it) but offlineStore still
        // thinks it's downloaded.  Remove the stale entry so we stop retrying.
        console.debug(`[OfflineBible] OPFS file missing for ${module} — removing stale offline entry`);
        offlineStore.removeDownloadedModule(module);
      } finally {
        this.loadingModules.delete(module);
      }
    })();
  }
}
