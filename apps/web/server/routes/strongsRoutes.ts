import { Router } from 'express';
import type { DatabaseManager } from '../DatabaseManager.js';
import { validateStrongsNumber } from '../utils/validation.js';
import { sendError, ErrorCodes } from '../utils/errorResponse.js';
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

      res.json({
        strongsNumber: number,
        word: entry.word,
        transliteration: entry.transliteration,
        definition: entry.definition,
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
