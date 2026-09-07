import { Router } from 'express';
import { VerseIdHelper } from '../core.js';
import type { DatabaseManager } from '../DatabaseManager.js';
import { validateBookNumber, validateChapter, validateVerse, validateModuleName } from '../utils/validation.js';
import { sendError, ErrorCodes } from '../utils/errorResponse.js';
import type { SiteSettings } from '../siteSettings.js';
import { isModuleActive } from '../siteSettings.js';
import { registerRoute } from './routeRegistry.js';
import type { ServerHookRegistry } from '../plugins/ServerHooks.js';

export function createCommentaryRoutes(db: DatabaseManager, siteSettings: SiteSettings | null, hooks?: ServerHookRegistry): Router {
  const router = Router();

  /** Filter commentaries by active status in settings */
  const filterActiveCommentaries = (modules: ReturnType<ReturnType<typeof db.getModuleMetadataRepo>['getByType']>) => {
    if (!siteSettings?.commentaries) return modules;
    return modules.filter(mod => {
      const abbr = mod.abbreviation || mod.getAbbreviation();
      return isModuleActive(siteSettings.commentaries, abbr);
    });
  };

  // Check which commentary modules have content for a given verse and/or chapter
  router.get('/availability/:book/:chapter', (req, res) => {
    try {
      const book = validateBookNumber(req.params.book);
      if (book === null) { sendError(res, 400, ErrorCodes.INVALID_PARAM, 'Invalid book number (1-66)'); return; }
      const chapter = validateChapter(req.params.chapter);
      if (chapter === null) { sendError(res, 400, ErrorCodes.INVALID_PARAM, 'Invalid chapter number'); return; }
      const verseParam = req.query.verse ? validateVerse(req.query.verse as string) : null;

      const metaRepo = db.getModuleMetadataRepo();
      const allCommentaries = filterActiveCommentaries(metaRepo.getByType('commentary'));

      const verseId = verseParam ? VerseIdHelper.calculate(book, chapter, verseParam) : null;
      const chapterStart = VerseIdHelper.calculate(book, chapter, 1);
      const chapterEnd = VerseIdHelper.calculate(book, chapter, 200);

      const result: Record<string, { hasVerse: boolean; hasChapter: boolean }> = {};

      // Cap availability checks to avoid long sequential DB scans across many modules
      const MAX_COMMENTARY_MODULES = 10;
      const limitedCommentaries = allCommentaries.slice(0, MAX_COMMENTARY_MODULES);

      for (const mod of limitedCommentaries) {
        const abbr = mod.abbreviation || mod.getAbbreviation();
        const repo = db.getCommentaryRepo(abbr);
        if (!repo) {
          result[abbr] = { hasVerse: false, hasChapter: false };
          continue;
        }

        let hasVerse = false;
        let hasChapter = false;

        // Check chapter-level content using a range query
        const chapterEntries = repo.getEntriesForRange(chapterStart, chapterEnd);
        hasChapter = chapterEntries.length > 0;

        // Check verse-level content
        if (verseId) {
          const verseEntries = repo.getEntriesForVerse(verseId);
          hasVerse = verseEntries.length > 0;
        }

        result[abbr] = { hasVerse, hasChapter };
      }

      res.json(result);
    } catch (error) {
      console.error('Error checking commentary availability:', error);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to check commentary availability');
    }
  });

  // Home tab: get all commentary entries for a verse across all modules, plus chapter-only modules
  router.get('/home/:book/:chapter', (req, res) => {
    try {
      const book = validateBookNumber(req.params.book);
      if (book === null) { sendError(res, 400, ErrorCodes.INVALID_PARAM, 'Invalid book number (1-66)'); return; }
      const chapter = validateChapter(req.params.chapter);
      if (chapter === null) { sendError(res, 400, ErrorCodes.INVALID_PARAM, 'Invalid chapter number'); return; }
      const verseParam = req.query.verse ? validateVerse(req.query.verse as string) : null;

      const metaRepo = db.getModuleMetadataRepo();
      const allCommentaries = filterActiveCommentaries(metaRepo.getByType('commentary'));

      const verseId = verseParam ? VerseIdHelper.calculate(book, chapter, verseParam) : null;
      const chapterStart = VerseIdHelper.calculate(book, chapter, 1);
      const chapterEnd = VerseIdHelper.calculate(book, chapter, 200);

      const verseModules: Array<{ moduleAbbr: string; moduleName: string; wordCount: number }> = [];
      const passageModules: Array<{ moduleAbbr: string; moduleName: string; wordCount: number }> = [];
      const chapterModules: Array<{ moduleAbbr: string; moduleName: string; wordCount: number }> = [];

      const isPassageLevel = (e: { entryLevel: string; verseIdStart?: number; verseIdEnd?: number }) =>
        e.entryLevel === 'passage' || e.entryLevel === 'chapter' ||
        (e.verseIdEnd && e.verseIdEnd !== e.verseIdStart);

      for (const mod of allCommentaries) {
        const abbr = mod.abbreviation || mod.getAbbreviation();
        const name = mod.moduleName || abbr;
        const repo = db.getCommentaryRepo(abbr);
        if (!repo) continue;

        if (verseId) {
          const entries = repo.getEntriesForVerse(verseId);
          if (entries.length > 0) {
            const verseLevel = entries.filter(e => !isPassageLevel(e));
            const passageLevel = entries.filter(e => isPassageLevel(e));

            if (verseLevel.length > 0) {
              // Module has verse-specific content — include all entries in word count
              const totalWords = entries.reduce((sum, e) => sum + (e.wordCount ?? 0), 0);
              verseModules.push({ moduleAbbr: abbr, moduleName: name, wordCount: totalWords });
            } else {
              // Module only has passage-level content for this verse
              const totalWords = passageLevel.reduce((sum, e) => sum + (e.wordCount ?? 0), 0);
              passageModules.push({ moduleAbbr: abbr, moduleName: name, wordCount: totalWords });
            }
          } else {
            const chapterEntries = repo.getEntriesForRange(chapterStart, chapterEnd);
            if (chapterEntries.length > 0) {
              const totalWords = chapterEntries.reduce((sum, e) => sum + (e.wordCount ?? 0), 0);
              chapterModules.push({ moduleAbbr: abbr, moduleName: name, wordCount: totalWords });
            }
          }
        } else {
          const chapterEntries = repo.getEntriesForRange(chapterStart, chapterEnd);
          if (chapterEntries.length > 0) {
            const totalWords = chapterEntries.reduce((sum, e) => sum + (e.wordCount ?? 0), 0);
            chapterModules.push({ moduleAbbr: abbr, moduleName: name, wordCount: totalWords });
          }
        }
      }

      // Sort alphabetically by module abbreviation
      verseModules.sort((a, b) => a.moduleAbbr.localeCompare(b.moduleAbbr));
      passageModules.sort((a, b) => a.moduleAbbr.localeCompare(b.moduleAbbr));
      chapterModules.sort((a, b) => a.moduleAbbr.localeCompare(b.moduleAbbr));

      res.json({ verseModules, passageModules, chapterModules });
    } catch (error) {
      console.error('Error getting commentary home data:', error);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to get commentary home data');
    }
  });

  // Compact chapter overview: metadata only (no content), all active modules
  router.get('/chapter-overview/:book/:chapter', (req, res) => {
    try {
      const book = validateBookNumber(req.params.book);
      if (book === null) { sendError(res, 400, ErrorCodes.INVALID_PARAM, 'Invalid book number (1-66)'); return; }
      const chapter = validateChapter(req.params.chapter);
      if (chapter === null) { sendError(res, 400, ErrorCodes.INVALID_PARAM, 'Invalid chapter number'); return; }

      const metaRepo = db.getModuleMetadataRepo();
      const allCommentaries = filterActiveCommentaries(metaRepo.getByType('commentary'));

      const chapterStart = VerseIdHelper.calculate(book, chapter, 0);
      const chapterEnd = VerseIdHelper.calculate(book, chapter, 999);

      const levelCodeMap: Record<string, string> = {
        verse: 'v',
        passage: 'p',
        chapter: 'c',
        book: 'b',
      };

      const modules: [string, string][] = [];
      const entries: [number, number, number, string, number][] = [];

      for (const mod of allCommentaries) {
        const abbr = mod.abbreviation || mod.getAbbreviation();
        const name = mod.moduleName || abbr;
        const repo = db.getCommentaryRepo(abbr);
        if (!repo) continue;

        // Summaries, not full entries: this endpoint reports what exists and
        // how long it is, and pulling every `content` blob to count words made
        // it the slowest call in a chapter navigation.
        const rawEntries = repo.getEntrySummariesForRange(chapterStart, chapterEnd);
        if (rawEntries.length === 0) continue;

        const moduleIdx = modules.length;
        modules.push([abbr, name]);

        for (const e of rawEntries) {
          const startVerse = (e.verseIdStart ?? 0) % 1000;
          const endVerse = (e.verseIdEnd ?? e.verseIdStart ?? 0) % 1000;
          const levelCode = levelCodeMap[e.entryLevel] ?? 'v';
          const wordCount = e.wordCount ?? 0;
          entries.push([moduleIdx, startVerse, endVerse, levelCode, wordCount]);
        }
      }

      res.set('Cache-Control', 'public, max-age=86400');
      res.json({ book, chapter, modules, entries });
    } catch (error) {
      console.error('Error getting commentary chapter overview:', error);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to get commentary chapter overview');
    }
  });

  // Get list of verse numbers with commentary content for a module in a chapter
  router.get('/:module/chapter-verses/:book/:chapter', (req, res) => {
    try {
      const moduleName = validateModuleName(req.params.module);
      if (!moduleName) { sendError(res, 400, ErrorCodes.INVALID_PARAM, 'Invalid module name'); return; }
      const book = validateBookNumber(req.params.book);
      if (book === null) { sendError(res, 400, ErrorCodes.INVALID_PARAM, 'Invalid book number (1-66)'); return; }
      const chapter = validateChapter(req.params.chapter);
      if (chapter === null) { sendError(res, 400, ErrorCodes.INVALID_PARAM, 'Invalid chapter number'); return; }

      const repo = db.getCommentaryRepo(moduleName);
      if (!repo) { sendError(res, 404, ErrorCodes.MODULE_NOT_FOUND, `Commentary not found: ${moduleName}`); return; }

      const chapterStart = VerseIdHelper.calculate(book, chapter, 1);
      const chapterEnd = VerseIdHelper.calculate(book, chapter, 200);
      const entries = repo.getEntriesForRange(chapterStart, chapterEnd);

      // Collect unique verse numbers that have content
      const verseSet = new Set<number>();
      for (const e of entries) {
        const startVerse = (e.verseIdStart ?? 0) % 1000;
        if (startVerse > 0) verseSet.add(startVerse);
        if (e.verseIdEnd) {
          const endVerse = e.verseIdEnd % 1000;
          // Add all verses in the range
          for (let v = startVerse; v <= endVerse; v++) {
            verseSet.add(v);
          }
        }
      }

      const verses = Array.from(verseSet).sort((a, b) => a - b);
      res.json({ verses });
    } catch (error) {
      console.error('Error getting chapter verses:', error);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to get chapter verses');
    }
  });

  // Commentary module info (for "About" section)
  router.get('/info/:module', (req, res): void => {
    try {
      const moduleName = validateModuleName(req.params.module);
      if (!moduleName) { sendError(res, 400, ErrorCodes.INVALID_PARAM, 'Invalid module name'); return; }

      const repo = db.getCommentaryRepo(moduleName);
      if (!repo) { sendError(res, 404, ErrorCodes.MODULE_NOT_FOUND, `Commentary not found: ${moduleName}`); return; }

      const info = repo.getModuleInfo();
      if (!info) { sendError(res, 404, ErrorCodes.MODULE_NOT_FOUND, `Module info not found: ${moduleName}`); return; }

      res.json({
        abbreviation: info.abbreviation,
        fullName: info.fullName,
        author: info.author ?? null,
        yearPublished: info.yearPublished ?? null,
        version: info.version ?? null,
        languageCode: info.languageCode,
        copyright: info.copyright ?? null,
        description: info.description ?? null,
        publisher: info.publisher ?? null,
        createdDate: info.createdDate ?? null,
      });
    } catch (error) {
      console.error('Error getting commentary info:', error);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to get commentary info');
    }
  });

  // Per-verse fast path: get commentary entries for a single verse from a single module.
  // Used by the mobile commentary detail view to render immediately before the full chapter
  // prefetch completes.
  router.get('/:module/verse/:verseId', async (req, res): Promise<void> => {
    const tStart = performance.now();
    try {
      const moduleName = validateModuleName(req.params.module);
      if (!moduleName) { sendError(res, 400, ErrorCodes.INVALID_PARAM, 'Invalid module name'); return; }
      const verseId = Number(req.params.verseId);
      if (!Number.isInteger(verseId) || verseId <= 0) {
        sendError(res, 400, ErrorCodes.INVALID_PARAM, 'Invalid verseId');
        return;
      }

      const repo = db.getCommentaryRepo(moduleName);
      if (!repo) { sendError(res, 404, ErrorCodes.MODULE_NOT_FOUND, `Commentary not found: ${moduleName}`); return; }

      const moduleInfo = repo.getModuleInfo();
      const contentFormat = moduleInfo?.metadata?.content_format as string | undefined;

      const tDbStart = performance.now();
      const rawEntries = repo.getEntriesForVerse(verseId);
      const tDbEnd = performance.now();

      const versePrefixRegex = /^(?:<[bp]>\s*)?Verse\s+\d+\.?\s*(?:<\/[bp]>\s*)/i;
      let entries = rawEntries.map(e => {
        let content = (e.content ?? '').trim()
          .replace(/^(\s*(<!\/?\w*>\s*|<br\s*\/?\s*>\s*|<\/?p\s*>\s*))+/i, '')
          .replace(/(\s*(<!\/?\w*>\s*|<br\s*\/?\s*>\s*|<\/?p\s*>\s*))+$/i, '')
          .trim();
        content = content.replace(versePrefixRegex, '');
        content = content.replace(/^(\s*(<!\/?\w*>\s*|<br\s*\/?\s*>\s*|<\/?p\s*>\s*))+/i, '').trim();
        return {
          entry_id: e.entryId ?? 0,
          verse_id_start: e.verseIdStart ?? 0,
          verse_id_end: e.verseIdEnd ?? 0,
          entry_level: e.entryLevel,
          content,
          word_count: e.wordCount ?? 0,
        };
      });

      if (hooks?.hasFilters('commentary:loaded')) {
        const book = Math.floor(verseId / 1000000);
        const chapter = Math.floor((verseId % 1000000) / 1000);
        const filtered = await hooks.applyFilters('commentary:loaded', { entries, module: moduleName, book, chapter });
        entries = filtered.entries as typeof entries;
      }

      res.set('Cache-Control', 'public, max-age=86400');
      if (req.query.debug === 'timing') {
        const tEnd = performance.now();
        res.setHeader('Server-Timing', `db;dur=${(tDbEnd - tDbStart).toFixed(1)}, total;dur=${(tEnd - tStart).toFixed(1)}`);
      }
      res.json({
        entries,
        ...(contentFormat ? { content_format: contentFormat } : {}),
      });
    } catch (error) {
      console.error('Error getting commentary for verse:', error);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to get commentary for verse');
    }
  });

  // Bulk: get all commentary entries for all modules in a chapter (for eager prefetch)
  router.get('/all/:book/:chapter', async (req, res): Promise<void> => {
    const tStart = performance.now();
    let tDbTotal = 0;
    try {
      const book = validateBookNumber(req.params.book);
      if (book === null) { sendError(res, 400, ErrorCodes.INVALID_PARAM, 'Invalid book number (1-66)'); return; }
      const chapter = validateChapter(req.params.chapter);
      if (chapter === null) { sendError(res, 400, ErrorCodes.INVALID_PARAM, 'Invalid chapter number'); return; }

      const metaRepo = db.getModuleMetadataRepo();
      let allCommentaries = filterActiveCommentaries(metaRepo.getByType('commentary'));

      // Optional `?modules=a,b,c` narrows the bulk fetch to a caller-chosen
      // subset. The client uses it to prefetch only what fits a size budget:
      // a chapter of a large commentary can run to megabytes on its own (Matthew
      // Henry's John 3 is ~2 MB), so "all active modules" is not a payload
      // anyone wants on a phone. Unknown or inactive names are simply dropped —
      // the caller gets what it asked for that exists, not an error.
      const requested = typeof req.query.modules === 'string' ? req.query.modules : null;
      if (requested !== null) {
        const wanted = new Set(
          requested
            .split(',')
            .map(m => validateModuleName(m.trim()))
            .filter((m): m is string => Boolean(m))
        );
        if (wanted.size === 0) { res.json({ modules: {} }); return; }
        allCommentaries = allCommentaries.filter(mod =>
          wanted.has(mod.abbreviation || mod.getAbbreviation())
        );
      }

      // Item #3: Cap commentary modules to prevent resource exhaustion
      const MAX_COMMENTARY_MODULES = 10;
      const limitedCommentaries = allCommentaries.slice(0, MAX_COMMENTARY_MODULES);

      const chapterStart = VerseIdHelper.calculate(book, chapter, 0);
      const chapterEnd = VerseIdHelper.calculate(book, chapter, 999);
      const versePrefixRegex = /^(?:<[bp]>\s*)?Verse\s+\d+\.?\s*(?:<\/[bp]>\s*)/i;

      const modules: Record<string, { entries: Array<{ entry_id: number; verse_id_start: number; verse_id_end: number; entry_level: string; content: string; word_count: number }>; content_format?: string }> = {};

      for (const mod of limitedCommentaries) {
        const abbr = mod.abbreviation || mod.getAbbreviation();
        const repo = db.getCommentaryRepo(abbr);
        if (!repo) continue;

        const moduleInfo = repo.getModuleInfo();
        const contentFormat = moduleInfo?.metadata?.content_format as string | undefined;
        const tDbStart = performance.now();
        const rawEntries = repo.getEntriesForRange(chapterStart, chapterEnd);
        tDbTotal += performance.now() - tDbStart;

        let entries = rawEntries.map(e => {
          let content = (e.content ?? '').trim()
            .replace(/^(\s*(<!\/?\w*>\s*|<br\s*\/?\s*>\s*|<\/?p\s*>\s*))+/i, '')
            .replace(/(\s*(<!\/?\w*>\s*|<br\s*\/?\s*>\s*|<\/?p\s*>\s*))+$/i, '')
            .trim();
          content = content.replace(versePrefixRegex, '');
          content = content.replace(/^(\s*(<!\/?\w*>\s*|<br\s*\/?\s*>\s*|<\/?p\s*>\s*))+/i, '').trim();
          return {
            entry_id: e.entryId ?? 0,
            verse_id_start: e.verseIdStart ?? 0,
            verse_id_end: e.verseIdEnd ?? 0,
            entry_level: e.entryLevel,
            content,
            word_count: e.wordCount ?? 0,
          };
        });

        if (hooks?.hasFilters('commentary:loaded')) {
          const filtered = await hooks.applyFilters('commentary:loaded', { entries, module: abbr, book, chapter });
          entries = filtered.entries as typeof entries;
        }

        modules[abbr] = { entries, ...(contentFormat ? { content_format: contentFormat } : {}) };
      }

      res.set('Cache-Control', 'public, max-age=86400');
      if (req.query.debug === 'timing') {
        const tEnd = performance.now();
        res.setHeader('Server-Timing', `db;dur=${tDbTotal.toFixed(1)}, total;dur=${(tEnd - tStart).toFixed(1)}`);
      }
      res.json({ modules });
    } catch (error) {
      console.error('Error getting all commentary:', error);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to get all commentary');
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

      const repo = db.getCommentaryRepo(moduleName);
      if (!repo) { sendError(res, 404, ErrorCodes.MODULE_NOT_FOUND, `Commentary not found: ${moduleName}`); return; }

      // Read content_format from module_info metadata
      const moduleInfo = repo.getModuleInfo();
      const contentFormat = moduleInfo?.metadata?.content_format as string | undefined;

      // Use a range query to catch ALL entries in the chapter, including those
      // with non-standard verse_id mappings (e.g. Calvin, Luther commentaries
      // that may have entries not aligned to individual verses).
      const chapterStart = VerseIdHelper.calculate(book, chapter, 0);
      const chapterEnd = VerseIdHelper.calculate(book, chapter, 999);
      const rawEntries = repo.getEntriesForRange(chapterStart, chapterEnd);

      // TODO: Shouldn't some of these be offered at the lower Commentary core "repo" level as an optional filter (maybe put this into its own filter)?  Maybe should be language-dependent though.
      // Strip leading "Verse N" prefix paragraphs from verse-level entries.
      // Handles both <p>Verse N</p> and <b>Verse N</b> variants (e.g. Clarke commentary).
      const versePrefixRegex = /^(?:<[bp]>\s*)?Verse\s+\d+\.?\s*(?:<\/[bp]>\s*)/i;

      let allEntries = rawEntries.map(e => {
        let content = (e.content ?? '').trim()
          .replace(/^(\s*(<!\/?\w*>\s*|<br\s*\/?\s*>\s*|<\/?p\s*>\s*))+/i, '')
          .replace(/(\s*(<!\/?\w*>\s*|<br\s*\/?\s*>\s*|<\/?p\s*>\s*))+$/i, '')
          .trim();
        // Strip leading "Verse N" labels (e.g. "<b>Verse 2</b>")
        content = content.replace(versePrefixRegex, '');
        // Clean up any junk tags left after stripping the prefix
        content = content.replace(/^(\s*(<!\/?\w*>\s*|<br\s*\/?\s*>\s*|<\/?p\s*>\s*))+/i, '').trim();
        return {
          entry_id: e.entryId ?? 0,
          verse_id_start: e.verseIdStart ?? 0,
          verse_id_end: e.verseIdEnd ?? 0,
          entry_level: e.entryLevel,
          content,
          word_count: e.wordCount ?? 0,
        };
      });

      if (hooks?.hasFilters('commentary:loaded')) {
        const filtered = await hooks.applyFilters('commentary:loaded', { entries: allEntries, module: moduleName, book, chapter });
        allEntries = filtered.entries as typeof allEntries;
      }

      // Commentary text is immutable per module version — safe to cache in the browser.
      // 24h max-age avoids re-fetching when navigating back to the same chapter.
      res.set('Cache-Control', 'public, max-age=86400');

      res.json({
        entries: allEntries,
        ...(contentFormat ? { content_format: contentFormat } : {}),
      });
    } catch (error) {
      console.error('Error getting commentary:', error);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to get commentary');
    }
  });

  return router;
}

registerRoute({
  path: '/api/commentary',
  createRoutes: (deps) => createCommentaryRoutes(deps.db, deps.siteSettings, deps.extra.hooks as ServerHookRegistry),
});
