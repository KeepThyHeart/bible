import { Router } from 'express';
// Through `server/core.ts`, not straight from '@bible/core'. The package is
// CJS, and Node's ESM named-export detection does not find every symbol behind
// its `__exportStar` re-exports — this one it misses, so a direct value import
// crashed the server at startup with "does not provide an export named
// 'readNewlineHandling'". Type-only imports are erased and stay direct.
import { readNewlineHandling } from '../core.js';
import type { DatabaseManager } from '../DatabaseManager.js';
import { validateModuleName } from '../utils/validation.js';
import { sendError, ErrorCodes } from '../utils/errorResponse.js';
import type { SiteSettings } from '../siteSettings.js';
import { isModuleActive, getModuleEntry } from '../siteSettings.js';
import { registerRoute } from './routeRegistry.js';
import type { ServerHookRegistry } from '../plugins/ServerHooks.js';

export function createDictionaryRoutes(db: DatabaseManager, siteSettings: SiteSettings | null, hooks?: ServerHookRegistry): Router {
  const router = Router();

  // List available dictionary modules (filtered by settings)
  router.get('/available', (_req, res): void => {
    try {
      const modules = db.getModuleMetadataRepo().getByType('dictionary');
      const filtered = modules.filter(mod => {
        if (!siteSettings?.dictionaries) return true;
        const abbr = mod.abbreviation || mod.getAbbreviation();
        return isModuleActive(siteSettings.dictionaries, abbr);
      });
      res.json(filtered.map(mod => {
        const abbr = mod.abbreviation || mod.getAbbreviation();
        const entry = siteSettings?.dictionaries ? getModuleEntry(siteSettings.dictionaries, abbr) : undefined;
        return {
          abbreviation: entry?.shortName || abbr,
          name: entry?.title || mod.moduleName,
          language_code: mod.languageCode,
        };
      }));
    } catch (error) {
      console.error('Error listing dictionaries:', error);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to list dictionaries');
    }
  });

  // Search across ALL dictionaries by entry title
  router.get('/search', (req, res): void => {
    try {
      const query = (req.query.q as string) || '';
      if (!query) { res.json([]); return; }
      const prefer = (req.query.prefer as string) || '';
      const limit = Math.min(parseInt(req.query.limit as string) || 40, 100);

      const allDicts = db.getAllDictionaryRepos().filter(d => {
        if (!siteSettings?.dictionaries) return true;
        return isModuleActive(siteSettings.dictionaries, d.abbreviation);
      });
      if (allDicts.length === 0) { res.json([]); return; }

      // Search each dictionary, collecting results with source info
      interface RawHit { entry_key: string; word: string; transliteration?: string; definition?: string; part_of_speech?: string; module_abbr: string; module_name: string; }
      const hits: RawHit[] = [];

      for (const { abbreviation, name, repo } of allDicts) {
        const entries = repo.searchByTitle(query, { limit: 30 });
        for (const e of entries) {
          hits.push({
            entry_key: e.entryKey,
            word: e.word ?? e.entryKey,
            transliteration: e.transliteration,
            definition: e.definition?.substring(0, 200),
            part_of_speech: e.partOfSpeech,
            module_abbr: abbreviation,
            module_name: name,
          });
        }
      }

      // Sort: exact title matches first, then preferred-module boost for ties
      const lowerQuery = query.toLowerCase();
      hits.sort((a, b) => {
        // Exact match on word/key gets top priority
        const aExact = (a.word?.toLowerCase() === lowerQuery || a.entry_key.toLowerCase() === lowerQuery) ? 0 : 1;
        const bExact = (b.word?.toLowerCase() === lowerQuery || b.entry_key.toLowerCase() === lowerQuery) ? 0 : 1;
        if (aExact !== bExact) return aExact - bExact;

        // Starts-with gets next priority
        const aStarts = (a.word?.toLowerCase().startsWith(lowerQuery) || a.entry_key.toLowerCase().startsWith(lowerQuery)) ? 0 : 1;
        const bStarts = (b.word?.toLowerCase().startsWith(lowerQuery) || b.entry_key.toLowerCase().startsWith(lowerQuery)) ? 0 : 1;
        if (aStarts !== bStarts) return aStarts - bStarts;

        // For equally good matches, prefer the selected dictionary
        if (prefer) {
          const aPref = a.module_abbr === prefer ? 0 : 1;
          const bPref = b.module_abbr === prefer ? 0 : 1;
          if (aPref !== bPref) return aPref - bPref;
        }

        // Alphabetical by word
        return (a.word ?? a.entry_key).localeCompare(b.word ?? b.entry_key);
      });

      res.json(hits.slice(0, limit));
    } catch (error) {
      console.error('Error searching dictionaries:', error);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to search dictionaries');
    }
  });

  // Search entries in a dictionary module
  router.get('/:module/search', (req, res): void => {
    try {
      const query = (req.query.q as string) || '';
      if (!query) { res.json([]); return; }

      const moduleName = validateModuleName(req.params.module);
      if (!moduleName) { sendError(res, 400, ErrorCodes.INVALID_PARAM, 'Invalid module name'); return; }
      const repo = db.getDictionaryRepo(moduleName);
      if (!repo) { res.json([]); return; }

      const entries = repo.searchEntries(query, { limit: 30 });
      const lowerQuery = query.toLowerCase();

      // Sort by title match quality: exact > starts-with > contains > alphabetical
      const mapped = entries.map(e => ({
        entry_key: e.entryKey,
        word: e.word,
        transliteration: e.transliteration,
        definition: e.definition?.substring(0, 200),
        part_of_speech: e.partOfSpeech,
      }));

      mapped.sort((a, b) => {
        const aWord = (a.word ?? a.entry_key).toLowerCase();
        const bWord = (b.word ?? b.entry_key).toLowerCase();
        const aKey = a.entry_key.toLowerCase();
        const bKey = b.entry_key.toLowerCase();

        // Exact title match first
        const aExact = (aWord === lowerQuery || aKey === lowerQuery) ? 0 : 1;
        const bExact = (bWord === lowerQuery || bKey === lowerQuery) ? 0 : 1;
        if (aExact !== bExact) return aExact - bExact;

        // Starts-with match next
        const aStarts = (aWord.startsWith(lowerQuery) || aKey.startsWith(lowerQuery)) ? 0 : 1;
        const bStarts = (bWord.startsWith(lowerQuery) || bKey.startsWith(lowerQuery)) ? 0 : 1;
        if (aStarts !== bStarts) return aStarts - bStarts;

        // Alphabetical fallback
        return aWord.localeCompare(bWord);
      });

      res.json(mapped);
    } catch (error) {
      console.error('Error searching dictionary:', error);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to search dictionary');
    }
  });

  // Get letter index with counts
  router.get('/:module/letters', (req, res): void => {
    try {
      const moduleName = validateModuleName(req.params.module);
      if (!moduleName) { sendError(res, 400, ErrorCodes.INVALID_PARAM, 'Invalid module name'); return; }
      const repo = db.getDictionaryRepo(moduleName);
      if (!repo) { res.json([]); return; }

      const rows = repo.getLetterIndex();
      res.json(rows);
    } catch (error) {
      console.error('Error getting dictionary letters:', error);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to get letters');
    }
  });

  // Browse entries by letter with pagination
  router.get('/:module/browse', (req, res): void => {
    try {
      const moduleName = validateModuleName(req.params.module);
      if (!moduleName) { sendError(res, 400, ErrorCodes.INVALID_PARAM, 'Invalid module name'); return; }
      const repo = db.getDictionaryRepo(moduleName);
      if (!repo) { res.json({ entries: [], total: 0 }); return; }

      const letter = (req.query.letter as string) || '';
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const offset = parseInt(req.query.offset as string) || 0;

      const result = repo.browseByLetter(letter || null, limit, offset);
      res.json({
        entries: result.entries.map(e => ({ entry_key: e.entryKey, word: e.word })),
        total: result.total,
        letter: letter || null,
      });
    } catch (error) {
      console.error('Error browsing dictionary:', error);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to browse dictionary');
    }
  });

  // Get adjacent entries (prev/next) for navigation
  router.get('/:module/adjacent/:key', (req, res): void => {
    try {
      const moduleName = validateModuleName(req.params.module);
      if (!moduleName) { sendError(res, 400, ErrorCodes.INVALID_PARAM, 'Invalid module name'); return; }
      const repo = db.getDictionaryRepo(moduleName);
      if (!repo) { res.json({ prev: null, next: null }); return; }

      const result = repo.getAdjacentEntries(req.params.key);
      res.json({
        prev: result.prev ? { entry_key: result.prev.entryKey, word: result.prev.word } : null,
        next: result.next ? { entry_key: result.next.entryKey, word: result.next.word } : null,
      });
    } catch (error) {
      console.error('Error getting adjacent entries:', error);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to get adjacent entries');
    }
  });

  // Get total entry count
  router.get('/:module/count', (req, res): void => {
    try {
      const moduleName = validateModuleName(req.params.module);
      if (!moduleName) { sendError(res, 400, ErrorCodes.INVALID_PARAM, 'Invalid module name'); return; }
      const repo = db.getDictionaryRepo(moduleName);
      if (!repo) { res.json({ count: 0 }); return; }

      res.json({ count: repo.getEntryCount() });
    } catch (error) {
      console.error('Error getting dictionary count:', error);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to get count');
    }
  });

  // Get a specific entry by key
  router.get('/:module/entry/:key', async (req, res): Promise<void> => {
    try {
      const moduleName = validateModuleName(req.params.module);
      if (!moduleName) { sendError(res, 400, ErrorCodes.INVALID_PARAM, 'Invalid module name'); return; }
      const repo = db.getDictionaryRepo(moduleName);
      if (!repo) {
        sendError(res, 404, ErrorCodes.MODULE_NOT_FOUND, 'Dictionary not found');
        return;
      }

      const entry = repo.getEntryByKey(req.params.key);
      if (!entry) {
        sendError(res, 404, ErrorCodes.NOT_FOUND, 'Entry not found');
        return;
      }

      let entries = [{
        entry_key: entry.entryKey,
        word: entry.word,
        transliteration: entry.transliteration,
        pronunciation: entry.pronunciation,
        part_of_speech: entry.partOfSpeech,
        definition: entry.definition,
        etymology: entry.etymology,
        usage_notes: entry.usageNotes,
        semantic_range: entry.semanticRange,
        related_words: entry.relatedWords,
        example_verses: entry.exampleVerses,
        // The module's declared `newline_handling` travels with the entry so
        // the client never has to fetch module info to know how to render the
        // definition. Absent when the module declares none, which leaves the
        // decision to the per-entry fallback in `resolveNewlineHandling`.
        newline_handling: readNewlineHandling(repo.getModuleInfo()?.metadata),
      }];

      if (hooks?.hasFilters('dictionary:loaded')) {
        const filtered = await hooks.applyFilters('dictionary:loaded', { entries, module: moduleName, key: req.params.key });
        entries = filtered.entries as typeof entries;
      }

      res.json(entries[0]);
    } catch (error) {
      console.error('Error getting dictionary entry:', error);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to get entry');
    }
  });

  return router;
}

registerRoute({
  path: '/api/dictionary',
  createRoutes: (deps) => createDictionaryRoutes(deps.db, deps.siteSettings, deps.extra.hooks as ServerHookRegistry),
});
