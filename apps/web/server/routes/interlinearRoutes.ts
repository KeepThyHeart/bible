import { Router } from 'express';
import { stripOsisTags } from '../core.js';
import type { DatabaseManager } from '../DatabaseManager.js';
import { validateBookNumber, validateChapter } from '../utils/validation.js';
import { sendError, ErrorCodes } from '../utils/errorResponse.js';
import { registerRoute } from './routeRegistry.js';
import { logger } from '../utils/logger.js';

/** Extract a brief English meaning from a Strong's definition string.
 *  Definitions typically have `:--meaning1, meaning2, ...` after the etymology. */
function extractBriefMeaning(definition: string | undefined): string {
  if (!definition) return '';
  const idx = definition.indexOf(':--');
  if (idx === -1) return '';
  // Get text after :-- and take the first meaning (before first comma or period)
  const meanings = definition.substring(idx + 3).trim();
  const match = meanings.match(/^([^,.\n]+)/);
  return match ? match[1].trim() : '';
}

export function createInterlinearRoutes(db: DatabaseManager): Router {
  const router = Router();

  router.get('/:book/:chapter', (req, res): void => {
    try {
      const book = validateBookNumber(req.params.book);
      if (book === null) { sendError(res, 400, ErrorCodes.INVALID_PARAM, 'Invalid book number (1-66)'); return; }
      const chapter = validateChapter(req.params.chapter);
      if (chapter === null) { sendError(res, 400, ErrorCodes.INVALID_PARAM, 'Invalid chapter number'); return; }

      const moduleName = (req.query.module as string) || 'KJV';
      const repo = db.getBibleRepo(moduleName);

      // An unresolvable module answers with no words rather than another
      // module's — the client aligns these rows against the *requested*
      // translation's text, so the wrong module's words would be worse than
      // none. Logged because an empty response is otherwise indistinguishable
      // from "this translation has no interlinear data".
      if (!repo) {
        logger.warn(`Interlinear requested for unknown Bible module "${moduleName}"; returning no words`);
        res.json({ words: [], strongsEntries: {} });
        return;
      }

      if (!repo.hasInterlinearData()) {
        res.json({ words: [], strongsEntries: {} });
        return;
      }

      // Returns Map<VerseId, InterlinearWord[]>
      const wordsMap = repo.getInterlinearWordsForChapter(book, chapter);
      const strongsEntries: Record<string, unknown> = {};
      const allWords: Array<{
        verseId: number;
        position: number;
        positionEnd: number;
        originalWord: string;
        transliteration: string;
        strongsNumber: string;
        morphology: string;
        gloss: string;
        language: string;
      }> = [];

      const strongsNumbers = new Set<string>();
      for (const [verseId, words] of wordsMap) {
        for (const w of words) {
          if (w.strongsNumber) strongsNumbers.add(w.strongsNumber);
          allWords.push({
            verseId,
            position: w.wordPositionStart,
            // Inclusive end index. The client cannot align rows against the
            // English text without it (see utils/interlinearCells.ts).
            positionEnd: w.wordPositionEnd,
            originalWord: stripOsisTags(w.originalWord || ''),
            transliteration: w.transliteration || '',
            strongsNumber: w.strongsNumber || '',
            morphology: w.morphology || '',
            gloss: stripOsisTags(w.gloss || ''),
            language: w.strongsNumber?.startsWith('H') ? 'Hebrew' : 'Greek',
          });
        }
      }

      for (const sn of strongsNumbers) {
        const dictName = sn.startsWith('H') ? 'strongshebrew' : 'strongsgreek';
        const dictRepo = db.getDictionaryRepo(dictName);
        if (dictRepo) {
          const numPart = sn.replace(/^[GHA]/i, '');
          const paddedKey = numPart.padStart(5, '0');
          const entry = dictRepo.getEntryByKey(sn)
            || dictRepo.getEntryByKey(paddedKey)
            || dictRepo.getEntryByKey(numPart);
          if (entry) {
            strongsEntries[sn] = {
              strongsNumber: sn,
              word: entry.word,
              transliteration: entry.transliteration,
              definition: entry.definition,
              partOfSpeech: entry.partOfSpeech,
              etymology: entry.etymology,
              briefMeaning: extractBriefMeaning(entry.definition),
            };
          }
        }
      }

      res.json({
        words: allWords,
        strongsEntries,
      });
    } catch (error) {
      console.error('Error getting interlinear data:', error);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to get interlinear data');
    }
  });

  return router;
}

registerRoute({
  path: '/api/interlinear',
  createRoutes: (deps) => createInterlinearRoutes(deps.db),
});
