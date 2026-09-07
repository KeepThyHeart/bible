import { Router } from 'express';
import * as path from 'path';
import { existsSync } from 'fs';
import { VerseIdHelper, VerseOfTheDayService, formatVerseText, EnrichmentRepository, BibleViewService } from '../core.js';
import type { DatabaseManager } from '../DatabaseManager.js';
import { validateBookNumber, validateChapter, validateVerseId, validateModuleName } from '../utils/validation.js';
import { sendError, ErrorCodes } from '../utils/errorResponse.js';
import { registerRoute } from './routeRegistry.js';
import type { ServerHookRegistry } from '../plugins/ServerHooks.js';

// Load VOTD data: check user data dir first (allows custom override), then bundled default.
//
// `fromDefault()` replaced the old `defaultFilePath` + `fromFile()` pair in
// core. The dataset is compiled in rather than read from a path derived from
// __dirname, which means there is no longer a "file is missing" case to fall
// through -- so this can no longer return null.
function loadVotdService(): InstanceType<typeof VerseOfTheDayService> {
  const dataDir = process.env.BIBLE_DATA_DIR;
  if (dataDir) {
    const userPath = path.join(dataDir, 'verse-of-the-day.json');
    if (existsSync(userPath)) return VerseOfTheDayService.fromFile(userPath);
  }
  return VerseOfTheDayService.fromDefault();
}
const votdService = loadVotdService();

export function createBibleRoutes(db: DatabaseManager, hooks?: ServerHookRegistry): Router {
  const router = Router();

  // Lazy-initialized BibleViewService
  let viewService: InstanceType<typeof BibleViewService> | null = null;
  function getViewService(): InstanceType<typeof BibleViewService> {
    if (!viewService) {
      const enrichDb = db.getEnrichmentsDb();
      const enrichRepo = enrichDb ? new EnrichmentRepository(enrichDb) : null;
      viewService = new BibleViewService(enrichRepo);
    }
    return viewService;
  }

  // Get section topics/titles for a book from the enrichments database
  router.get('/topics/:book', (req, res) => {
    try {
      const bookNum = validateBookNumber(req.params.book);
      if (bookNum === null) { sendError(res, 400, ErrorCodes.INVALID_PARAM, 'Invalid book number (1-66)'); return; }

      const topics = getViewService().getBookTopics(bookNum);
      res.json({ topics });
    } catch (error) {
      console.error('Error getting book topics:', error);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to get book topics');
    }
  });

  // Verse of the Day
  router.get('/votd', (req, res) => {
    try {
      const moduleAbbr = (req.query.module as string) || 'KJV';
      const repo = db.getBibleRepo(moduleAbbr);
      if (!repo) {
        sendError(res, 404, ErrorCodes.MODULE_NOT_FOUND, `Module not found: ${moduleAbbr}`);
        return;
      }

      if (!votdService) {
        sendError(res, 503, ErrorCodes.INTERNAL_ERROR, 'Verse of the day data not available');
        return;
      }
      const result = getViewService().getVerseOfTheDay(votdService, repo);
      res.json({ ...result, module: moduleAbbr });
    } catch (error) {
      console.error('Error getting verse of the day:', error);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to get verse of the day');
    }
  });

  // Batch verse texts — fetch multiple verses in a single request.
  // Returns only text fields (no interlinear), intended for topical index, cross-refs, etc.
  router.post('/:module/verses', (req, res): void => {
    try {
      const moduleName = validateModuleName(req.params.module);
      if (!moduleName) { sendError(res, 400, ErrorCodes.INVALID_PARAM, 'Invalid module name'); return; }

      const { verseIds } = req.body as { verseIds?: unknown };
      if (!Array.isArray(verseIds) || verseIds.length === 0) {
        sendError(res, 400, ErrorCodes.INVALID_PARAM, 'verseIds must be a non-empty array'); return;
      }
      if (verseIds.length > 500) {
        sendError(res, 400, ErrorCodes.INVALID_PARAM, 'Maximum 500 verse IDs per request'); return;
      }

      const ids: number[] = [];
      for (const id of verseIds) {
        const validated = validateVerseId(String(id));
        if (validated === null) { sendError(res, 400, ErrorCodes.INVALID_PARAM, `Invalid verse ID: ${id}`); return; }
        ids.push(validated);
      }

      const repo = db.getBibleRepo(moduleName);
      if (!repo) { sendError(res, 404, ErrorCodes.MODULE_NOT_FOUND, `Module not found: ${moduleName}`); return; }

      const verseMap = repo.getVerseTexts(ids);
      const verses: Record<string, { verse_id: number; text: string; text_html: string }> = {};
      for (const [vid, verse] of verseMap) {
        const { textHtml } = formatVerseText(verse);
        verses[String(vid)] = {
          verse_id: vid,
          text: verse.text,
          text_html: textHtml,
        };
      }

      res.json({ verses });
    } catch (error) {
      console.error('Error getting batch verses:', error);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to get verses');
    }
  });

  // Verse route must come before chapter route to avoid /:module/verse/:verseId
  // being matched as /:module/:book/:chapter
  router.get('/:module/verse/:verseId', (req, res): void => {
    try {
      const moduleName = validateModuleName(req.params.module);
      if (!moduleName) { sendError(res, 400, ErrorCodes.INVALID_PARAM, 'Invalid module name'); return; }
      const verseId = validateVerseId(req.params.verseId);
      if (verseId === null) { sendError(res, 400, ErrorCodes.INVALID_PARAM, 'Invalid verse ID'); return; }

      const repo = db.getBibleRepo(moduleName);
      if (!repo) { sendError(res, 404, ErrorCodes.MODULE_NOT_FOUND, `Module not found: ${moduleName}`); return; }

      const verse = repo.getVerse(verseId);
      if (!verse) { sendError(res, 404, ErrorCodes.NOT_FOUND, 'Verse not found'); return; }

      const parsed = VerseIdHelper.parse(verse.verseId);
      const { textHtml, isParagraphStart, sectionHeading } = formatVerseText(verse);

      res.set('Cache-Control', 'public, max-age=604800'); // 7 days
      res.json({
        verse_id: verse.verseId,
        book_number: parsed.bookNumber,
        chapter: parsed.chapter,
        verse: parsed.verse,
        text: verse.text,
        text_html: textHtml,
        is_paragraph_start: isParagraphStart,
        words_of_christ: verse.hasWordsOfChrist(),
        section_heading: sectionHeading,
      });
    } catch (error) {
      console.error('Error getting verse:', error);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to get verse');
    }
  });

  router.get('/:module/:book/:chapter', async (req, res): Promise<void> => {
    try {
      const moduleName = validateModuleName(req.params.module);
      if (!moduleName) { sendError(res, 400, ErrorCodes.INVALID_PARAM, 'Invalid module name'); return; }
      const book = validateBookNumber(req.params.book);
      if (book === null) { sendError(res, 400, ErrorCodes.INVALID_PARAM, 'Invalid book number (1-66)'); return; }
      const chapter = validateChapter(req.params.chapter);
      if (chapter === null) { sendError(res, 400, ErrorCodes.INVALID_PARAM, 'Invalid chapter number'); return; }

      const repo = db.getBibleRepo(moduleName);
      if (!repo) { sendError(res, 404, ErrorCodes.MODULE_NOT_FOUND, `Module not found: ${moduleName}`); return; }

      const formatted = getViewService().getFormattedChapter(repo, book, chapter);

      // Apply plugin filter hooks (verse:loaded) if any are registered
      let finalVerses = formatted;
      if (hooks?.hasFilters('verse:loaded')) {
        const filtered = await hooks.applyFilters('verse:loaded', {
          verses: formatted, module: moduleName, book, chapter,
        });
        finalVerses = filtered.verses as typeof formatted;
      }

      const response: Record<string, unknown> = {
        verses: finalVerses,
        hasInterlinearData: repo.hasInterlinearData(),
      };

      // When no verses found, include coverage info so the UI can explain why
      if (finalVerses.length === 0) {
        response.coveredBooks = repo.getCoveredBooks();
      }

      // Bible text is immutable — cache aggressively in the browser's HTTP disk cache.
      // This overrides the blanket no-cache on /api/* (which exists for auth-sensitive routes).
      // stale-while-revalidate lets the service worker serve repeat visits instantly while
      // still revalidating in the background.
      res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=86400');
      res.json(response);

      // Fire action hook (non-blocking)
      hooks?.fireActions('chapter:viewed', { module: moduleName, book, chapter });
    } catch (error) {
      console.error('Error getting chapter:', error);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to get chapter');
    }
  });

  return router;
}

registerRoute({
  path: '/api/bible',
  createRoutes: (deps) => createBibleRoutes(deps.db, deps.extra.hooks as ServerHookRegistry),
});
