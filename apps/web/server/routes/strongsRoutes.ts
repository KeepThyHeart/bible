import { Router } from 'express';
import type { DatabaseManager } from '../DatabaseManager.js';
import { validateStrongsNumber } from '../utils/validation.js';
import { sendError, ErrorCodes } from '../utils/errorResponse.js';
import { parseStrongsHead } from '../utils/strongsEntries.js';
import { registerRoute } from './routeRegistry.js';

export function createStrongsRoutes(db: DatabaseManager): Router {
  const router = Router();

  router.get('/:number', (req, res): void => {
    try {
      const number = validateStrongsNumber(req.params.number);
      if (!number) { sendError(res, 400, ErrorCodes.INVALID_PARAM, 'Invalid Strong\'s number format (e.g., G2316, H1234)'); return; }

      const dictName = number.startsWith('H') ? 'strongshebrew' : 'strongsgreek';
      const dictRepo = db.getDictionaryRepo(dictName);
      if (!dictRepo) { sendError(res, 404, ErrorCodes.NOT_FOUND, 'Dictionary not available'); return; }

      // Try multiple key formats: G2316, 02316, 2316
      const numericPart = number.replace(/^[GHA]/i, '');
      const paddedKey = numericPart.padStart(5, '0');
      const entry = dictRepo.getEntryByKey(number)
        || dictRepo.getEntryByKey(paddedKey)
        || dictRepo.getEntryByKey(numericPart);
      if (!entry) { sendError(res, 404, ErrorCodes.NOT_FOUND, `Entry not found: ${number}`); return; }

      // The stored word is the raw key and the definition opens with the raw lexicon
      // line; show the parsed word/transliteration/pronunciation instead (B-177, as B-165).
      const head = parseStrongsHead(entry.definition ?? '', number.startsWith('H') ? 'H' : 'G');
      res.json({
        strongsNumber: number,
        word: head ? (head.word || head.transliteration) : entry.word,
        transliteration: head ? (head.word ? head.transliteration : undefined) : entry.transliteration,
        pronunciation: head ? head.pronunciation : undefined,
        definition: head ? head.body : entry.definition,
        partOfSpeech: entry.partOfSpeech,
        etymology: entry.etymology,
      });
    } catch (error) {
      console.error('Error getting Strong\'s entry:', error);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to get Strong\'s entry');
    }
  });

  return router;
}

registerRoute({
  path: '/api/strongs',
  createRoutes: (deps) => createStrongsRoutes(deps.db),
});
