/**
 * Study Mode IPC Handlers
 * Handles verse links queries, interlinear data, cross-references, and related study tools
 */

import type { IpcMain } from 'electron';
import log from 'electron-log/main';
import path from 'path';
import fs from 'fs';
import {
  VerseLinksService,
  VerseLinksSummary,
  BibleRepository,
  UserCrossReferenceRepository,
  ModuleMetadataRepository,
  UserNoteRepository,
  CommentaryRepository,
  CrossReferenceRepository,
  BookRepository,
  stripOsisTags,
} from '@bible/core';
import type { ISql } from '@bible/core';
import { getBibleRepository } from './bibleHandlers';
import { getDataPath } from '../utils/appPaths';
import { ipcHandler, IpcKnownError } from './handler-helper';
import { getSharedMainDb } from '../services/sharedMainDb';
import { getModuleDatabaseRegistry } from '../services/ModuleDatabaseRegistry';
import { getStudyCacheService, type StudyOverviewPayload } from '../services/StudyCacheService';

// Database paths
const DATA_DIR = getDataPath();
const USERS_DIR = path.join(DATA_DIR, 'users');

/**
 * Get or create a cached Bible repository for interlinear/study queries.
 *
 * Prefers the shared bibleHandlers loader so callers hit the same
 * BibleRepository instance as the main Bible pane. If the Bible module
 * hasn't been touched yet, falls back to opening via the ModuleDatabaseRegistry
 * (which also backs `ModuleLoader`), so both paths share one DB handle.
 */
function getCachedBibleRepo(abbreviation: string): BibleRepository | null {
  const t0 = Date.now();

  const sharedRepo = getBibleRepository(abbreviation);
  if (sharedRepo) {
    const elapsed = Date.now() - t0;
    if (elapsed > 50) log.warn(`[studyHandlers] getCachedBibleRepo(${abbreviation}) via shared cache took ${elapsed}ms`);
    return sharedRepo;
  }

  log.info(`[studyHandlers] getCachedBibleRepo(${abbreviation}): shared repo not loaded yet, opening via registry`);
  const provider = getModuleDatabaseRegistry().openByAbbreviation(abbreviation, 'bible', { readonly: true });
  if (!provider) {
    log.warn(`[studyHandlers] Bible database not found for abbreviation: ${abbreviation}`);
    return null;
  }
  return new BibleRepository(provider);
}

/**
 * Get database for a specific module (by module ID).
 *
 * Delegates to the ModuleDatabaseRegistry. The registry keys connections by
 * absolute path, so a moduleId lookup here returns the same handle as any
 * abbreviation lookup elsewhere for the same DB file.
 */
function getModuleDb(moduleId: number): ISql | undefined {
  const provider = getModuleDatabaseRegistry().openByModuleId(moduleId, { readonly: true });
  return provider ?? undefined;
}

/**
 * Get user database path for current user
 * TODO: Support multiple users
 */
function getUserDbPath(): string {
  return path.join(USERS_DIR, 'user_default.db');
}

// =============================================================================
// VERSE LINKS HELPERS
// =============================================================================

/** Repository cache keyed by module ID */
const commentaryRepoCache = new Map<number, CommentaryRepository>();
const crossRefRepoCache = new Map<number, CrossReferenceRepository>();
const bookRepoCache = new Map<number, BookRepository>();

function getCommentaryRepo(moduleId: number): CommentaryRepository | undefined {
  if (commentaryRepoCache.has(moduleId)) return commentaryRepoCache.get(moduleId)!;
  const db = getModuleDb(moduleId);
  if (!db) return undefined;
  const repo = new CommentaryRepository(db);
  commentaryRepoCache.set(moduleId, repo);
  return repo;
}

function getCrossRefRepo(moduleId: number): CrossReferenceRepository | undefined {
  if (crossRefRepoCache.has(moduleId)) return crossRefRepoCache.get(moduleId)!;
  const db = getModuleDb(moduleId);
  if (!db) return undefined;
  const repo = new CrossReferenceRepository(db);
  crossRefRepoCache.set(moduleId, repo);
  return repo;
}

function getBookRepo(moduleId: number): BookRepository | undefined {
  if (bookRepoCache.has(moduleId)) return bookRepoCache.get(moduleId)!;
  const db = getModuleDb(moduleId);
  if (!db) return undefined;
  const repo = new BookRepository(db);
  bookRepoCache.set(moduleId, repo);
  return repo;
}

/**
 * Create a VerseLinksService with all repository dependencies wired up.
 *
 * Uses the shared `main.db` connection (via `getSharedMainDb`) instead of
 * opening a new one each call. The read-only user DB handle for verse-link
 * lookups is cached in-module for the same reason - opening a fresh
 * SqliteProvider per request was showing up as measurable overhead in the
 * batch verse-links path.
 */
let cachedUserNoteRepo: UserNoteRepository | null | undefined;
let cachedUserXrefRepo: UserCrossReferenceRepository | null | undefined;
function getUserDbProvider(): ISql | undefined {
  // User DB may not exist yet (created on first note/highlight). We open it
  // through the registry's `openByPath` so shutdown covers the handle too.
  const userDbPath = getUserDbPath();
  if (!fs.existsSync(userDbPath)) return undefined;
  const provider = getModuleDatabaseRegistry().openByPath(userDbPath, { readonly: true });
  return provider ?? undefined;
}
function getUserNoteRepoForLinks(): UserNoteRepository | undefined {
  if (cachedUserNoteRepo !== undefined) {
    return cachedUserNoteRepo ?? undefined;
  }
  const provider = getUserDbProvider();
  if (!provider) {
    cachedUserNoteRepo = null;
    return undefined;
  }
  cachedUserNoteRepo = new UserNoteRepository(provider);
  return cachedUserNoteRepo;
}
function getUserXrefRepoForLinks(): UserCrossReferenceRepository | undefined {
  if (cachedUserXrefRepo !== undefined) {
    return cachedUserXrefRepo ?? undefined;
  }
  const provider = getUserDbProvider();
  if (!provider) {
    cachedUserXrefRepo = null;
    return undefined;
  }
  cachedUserXrefRepo = new UserCrossReferenceRepository(provider);
  return cachedUserXrefRepo;
}

function createVerseLinksService(): VerseLinksService {
  const moduleMetadataRepo = new ModuleMetadataRepository(getSharedMainDb());
  return new VerseLinksService(
    moduleMetadataRepo,
    getUserNoteRepoForLinks(),
    (moduleId) => getCommentaryRepo(moduleId),
    (moduleId) => getCrossRefRepo(moduleId),
    (moduleId) => getBookRepo(moduleId),
    getUserXrefRepoForLinks()
  );
}

// =============================================================================
// VERSE LINKS HANDLERS
// =============================================================================

/**
 * Register Study mode IPC handlers (verse links, interlinear, user cross-references).
 * Follows the same `registerXxxHandlers(ipcMain)` pattern as the other handler
 * files - called explicitly from `electron/main.ts`.
 */
export function registerStudyHandlers(_ipcMain: IpcMain): void {
  /**
   * Get verse links for a single verse
   */
  ipcHandler<[number, number[] | undefined], VerseLinksSummary>(
  'study:getVerseLinks',
  async (verseId, openModuleIds) => {
    log.debug(`Getting verse links for verse ${verseId}`);

    const service = createVerseLinksService();
    const openModules = openModuleIds ? new Set(openModuleIds) : undefined;
    const links = await service.getVerseLinks(verseId, openModules);

    log.debug(`Found ${links.commentaries.direct.length} direct commentaries, ${links.commentaries.mentions.length} mentions for verse ${verseId}`);

    return links;
  }
);

/**
 * Get verse links for multiple verses (batch)
 */
ipcHandler<[number[], number[] | undefined], Record<number, VerseLinksSummary>>(
  'study:getBatchVerseLinks',
  async (verseIds, openModuleIds) => {
    log.debug(`Getting batch verse links for ${verseIds.length} verses`);

    const service = createVerseLinksService();
    const openModules = openModuleIds ? new Set(openModuleIds) : undefined;
    const linksMap = await service.getBatchVerseLinks(verseIds, openModules);

    const result: Record<number, VerseLinksSummary> = {};
    linksMap.forEach((value, key) => {
      result[key] = value;
    });

    log.debug(`Batch query complete for ${verseIds.length} verses`);
    return result;
  }
);

/**
 * Pre-generated study overview for one chapter.
 *
 * One round trip, in place of a per-verse `xref:getGroupsForVerse` fan-out
 * (~31 calls per chapter per cross-reference module).
 * Answers `{ available: false }` when the cache is missing or was generated
 * against a different module set - callers must fall back to live queries, and
 * `StudyCacheService` documents why that invalidation is wholesale.
 */
ipcHandler<[number, number], StudyOverviewPayload>(
  'study:getOverview',
  (book, chapter) => getStudyCacheService().getChapter(book, chapter)
);

/**
 * Get all mentions of a verse in a specific commentary
 */
ipcHandler<[number, number], unknown[]>(
  'study:getCommentaryMentions',
  (moduleId, verseId) => {
    log.debug(`Getting commentary mentions for verse ${verseId} in module ${moduleId}`);

    const moduleDb = getModuleDb(moduleId);
    if (!moduleDb) {
      throw new IpcKnownError('not_found', `Module ${moduleId} not found`);
    }

    const mentions = moduleDb.queryAll<{
      reference_id: number;
      entry_id: number;
      context: string | null;
      position: number | null;
    }>(
      `SELECT vr.reference_id, vr.entry_id, vr.context, vr.position, ce.verse_id_start
       FROM verse_reference vr
       JOIN commentary_entry ce ON vr.entry_id = ce.entry_id
       WHERE vr.verse_id_start <= ? AND (vr.verse_id_end IS NULL OR vr.verse_id_end >= ?)
       ORDER BY ce.verse_id_start`,
      [verseId, verseId]
    );

    log.debug(`Found ${mentions.length} mentions`);
    return mentions;
  }
);

// =============================================================================
// INTERLINEAR HANDLERS
// =============================================================================

/**
 * Get interlinear words for a specific verse (returns fallback on error)
 */
ipcHandler<[string, number], any[]>('bible:getInterlinearWords', (abbreviation, verseId) => {
  try {
    const repo = getCachedBibleRepo(abbreviation);
    if (!repo) {
      log.warn(`[studyHandlers] No Bible repository available for ${abbreviation}`);
      return [];
    }

    const words = repo.getInterlinearWords(verseId);

    return words.map(word => ({
      wordPositionStart: word.wordPositionStart,
      wordPositionEnd: word.wordPositionEnd,
      // Some interlinear sources carry raw OSIS/SWORD XML markup (e.g. <divineName>)
      // in original_word/gloss. Strip it here so it never reaches the renderer.
      originalWord: word.originalWord ? stripOsisTags(word.originalWord) : '',
      transliteration: word.transliteration,
      strongsNumber: word.strongsNumber,
      morphology: word.morphology,
      lemma: word.lemma,
      gloss: word.gloss ? stripOsisTags(word.gloss) : word.gloss
    }));
  } catch (error) {
    log.error('[studyHandlers] Error getting interlinear words:', error);
    return [];
  }
});

/**
 * Get interlinear words for an entire chapter (batch - much more efficient, returns fallback on error)
 */
ipcHandler<[string, number, number], Record<number, any[]>>(
  'bible:getInterlinearWordsForChapter',
  (abbreviation, bookNumber, chapter) => {
    const startTime = Date.now();
    try {
      const repo = getCachedBibleRepo(abbreviation);
      if (!repo) {
        log.warn(`[studyHandlers] No Bible repository available for ${abbreviation}`);
        return {};
      }

      const wordsMap = repo.getInterlinearWordsForChapter(bookNumber, chapter);
      const queryTime = Date.now() - startTime;

      // Convert Map to plain object for IPC transfer
      const result: Record<number, any[]> = {};
      let totalWords = 0;
      wordsMap.forEach((words, verseId) => {
        totalWords += words.length;
        result[verseId] = words.map(word => ({
          wordPositionStart: word.wordPositionStart,
          wordPositionEnd: word.wordPositionEnd,
          // See getInterlinearWords above: strip raw OSIS/SWORD XML markup.
          originalWord: word.originalWord ? stripOsisTags(word.originalWord) : '',
          transliteration: word.transliteration,
          strongsNumber: word.strongsNumber,
          morphology: word.morphology,
          lemma: word.lemma,
          gloss: word.gloss ? stripOsisTags(word.gloss) : word.gloss
        }));
      });

      const totalTime = Date.now() - startTime;
      log.info(`[studyHandlers] getInterlinearWordsForChapter(${abbreviation}, book=${bookNumber}, ch=${chapter}): ${totalWords} words across ${wordsMap.size} verses in ${queryTime}ms query / ${totalTime}ms total`);

      return result;
    } catch (error) {
      log.error('[studyHandlers] Error getting interlinear words for chapter:', error);
      return {};
    }
  }
);

/**
 * Check if a Bible module has interlinear data (returns fallback on error)
 */
ipcHandler<[string], boolean>('bible:hasInterlinearData', (abbreviation) => {
  const handlerStart = Date.now();
  log.info(`[studyHandlers] hasInterlinearData(${abbreviation}): handler entered`);
  try {
    const repoStart = Date.now();
    const repo = getCachedBibleRepo(abbreviation);
    const repoTime = Date.now() - repoStart;

    if (!repo) {
      log.warn(`[studyHandlers] hasInterlinearData: No Bible repository available for ${abbreviation} (repo lookup: ${repoTime}ms)`);
      return false;
    }

    const queryStart = Date.now();
    const hasData = repo.hasInterlinearData();
    const queryTime = Date.now() - queryStart;
    const totalTime = Date.now() - handlerStart;

    log.info(`[studyHandlers] hasInterlinearData(${abbreviation}): ${hasData} (repo: ${repoTime}ms, query: ${queryTime}ms, total: ${totalTime}ms)`);

    return hasData;
  } catch (error) {
    log.error('[studyHandlers] Error checking interlinear data:', error);
    return false;
  }
});

// =============================================================================
// USER CROSS-REFERENCE HANDLERS
// =============================================================================

/**
 * Get user-created cross-references for a verse (returns fallback on error)
 */
ipcHandler<[string, number], any[]>('bible:getUserCrossReferences', (username, verseId) => {
  try {
    const dbPath = path.join(USERS_DIR, `user_${username}.db`);
    const db = getModuleDatabaseRegistry().openByPath(dbPath);
    if (!db) return [];
    const repo = new UserCrossReferenceRepository(db);

    const xrefs = repo.getForVerse(verseId);

    // Core stores each side as a range (`*VerseIdStart`/`*VerseIdEnd`); this IPC
    // shape is flat single-verse, and the renderer reads it that way
    // (VerseLinksDisplay, MultiReferenceDialog). Collapse to the range start
    // rather than widening the channel: nothing on the renderer side draws
    // multi-verse links yet, so a wider payload would be unread.
    return xrefs.map(xref => ({
      userXrefId: xref.userXrefId,
      fromVerseId: xref.fromVerseIdStart,
      toVerseId: xref.toVerseIdStart,
      notes: xref.notes,
      createdDate: xref.createdDate
    }));
  } catch (error) {
    log.error('[studyHandlers] Error getting user cross-references:', error);
    return [];
  }
});

/**
 * Create a new user cross-reference
 */
ipcHandler<[string, number, number, string | undefined], { success: boolean; userXrefId?: number }>(
  'bible:createUserCrossReference',
  (username, fromVerseId, toVerseId, notes) => {
    const dbPath = path.join(USERS_DIR, `user_${username}.db`);
    const db = getModuleDatabaseRegistry().openByPath(dbPath);
    if (!db) {
      throw new IpcKnownError('not_found', `User database not found for ${username}`);
    }
    const repo = new UserCrossReferenceRepository(db);

    const xref = repo.create({
      fromVerseId,
      toVerseId,
      notes
    } as any);

    return {
      success: true,
      userXrefId: xref.userXrefId
    };
  }
);

/**
 * Delete a user cross-reference
 */
ipcHandler<[string, number], { success: boolean }>(
  'bible:deleteUserCrossReference',
  (username, userXrefId) => {
    const dbPath = path.join(USERS_DIR, `user_${username}.db`);
    const db = getModuleDatabaseRegistry().openByPath(dbPath);
    if (!db) {
      throw new IpcKnownError('not_found', `User database not found for ${username}`);
    }
    const repo = new UserCrossReferenceRepository(db);

    const success = repo.delete(userXrefId);

    return { success };
  }
);

/**
 * Get verse text for multiple verses (for cross-reference previews, returns fallback on error)
 */
ipcHandler<[string, number[]], { [key: number]: string }>(
  'bible:getVerseTexts',
  (abbreviation, verseIds) => {
    try {
      const repo = getCachedBibleRepo(abbreviation);
      if (!repo) {
        log.warn(`[studyHandlers] No Bible repository available for ${abbreviation}`);
        return {};
      }

      const result: { [key: number]: string } = {};

      for (const verseId of verseIds) {
        const verse = repo.getVerse(verseId);
        if (verse) {
          result[verseId] = verse.textPlain || verse.text;
        }
      }

      return result;
    } catch (error) {
      log.error('[studyHandlers] Error getting verse texts:', error);
      return {};
    }
  }
);

  log.info('[studyHandlers] Study mode IPC handlers registered');
}

// No process-level cleanup here: every DB handle that studyHandlers touches
// is owned by ModuleDatabaseRegistry, whose `closeAll()` runs on app
// `will-quit` / `quit` in main.ts.
