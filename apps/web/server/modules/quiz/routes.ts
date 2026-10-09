import { Router } from 'express';
import { mergeCatalogs } from '../../core.js';
import type { QuizCatalog, QuizFilter, QuizPassage, QuizQuestion } from '@bible/core/browser';
import type { DatabaseManager } from '../../DatabaseManager.js';
import { sendError, ErrorCodes } from '../../utils/errorResponse.js';
import { registerRoute } from '../../routes/routeRegistry.js';

/** The catalog is static for the installed module versions: cached in memory, ETag, long-ish max-age. */
const CATALOG_CACHE_CONTROL = 'private, max-age=3600, stale-while-revalidate=86400';
const QUESTIONS_CACHE_CONTROL = 'private, max-age=3600';
const MAX_RANGES = 50;
const MAX_QUESTIONS = 2000;

/** A valid verse id: book 1..66, chapter 1..150, verse 0..999 (999 = end of chapter). */
function validVerseId(id: number): boolean {
  const book = Math.floor(id / 1_000_000);
  const chapter = Math.floor((id % 1_000_000) / 1000);
  const verse = id % 1000;
  return book >= 1 && book <= 66 && chapter >= 1 && chapter <= 150 && verse <= 999;
}

/** Reads every `range=START-END` query value; null when any is malformed or there are 0 or too many. */
function parseRanges(raw: unknown): QuizPassage[] | null {
  const values = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  if (values.length < 1 || values.length > MAX_RANGES) return null;
  const passages: QuizPassage[] = [];
  for (const v of values) {
    if (typeof v !== 'string') return null;
    const m = /^(\d{1,10})-(\d{1,10})$/.exec(v);
    if (!m) return null;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (!validVerseId(a) || !validVerseId(b)) return null;
    if (Math.floor(a / 1_000_000) !== Math.floor(b / 1_000_000)) return null; // one book per range
    passages.push(a <= b ? { start: a, end: b } : { start: b, end: a });
  }
  return passages;
}

/** A repeated or comma-separated query value as a list of non-empty strings. */
function listParam(raw: unknown): string[] {
  const values = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  return values
    .filter((v): v is string => typeof v === 'string')
    .flatMap(v => v.split(','))
    .map(v => v.trim())
    .filter(Boolean);
}

export function createQuizRoutes(db: DatabaseManager): Router {
  const router = Router();
  let cachedCatalog: QuizCatalog | null = null;

  // The merged catalog: installed quiz modules and per-chapter question counts.
  router.get('/', (_req, res): void => {
    try {
      if (!cachedCatalog) {
        const repos = db.getQuizRepos();
        if (repos.length === 0) {
          sendError(res, 404, ErrorCodes.NOT_FOUND, 'No quiz module installed');
          return;
        }
        cachedCatalog = mergeCatalogs(repos.map(r => ({ modules: [r.getInfo()], coverage: r.getCoverage() })));
      }
      res.set('Cache-Control', CATALOG_CACHE_CONTROL);
      res.json(cachedCatalog);
    } catch (error) {
      console.error('Error getting quiz catalog:', error);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to get quiz catalog');
    }
  });

  // Questions overlapping the given verse-id ranges, merged over every module.
  router.get('/questions', (req, res): void => {
    try {
      const passages = parseRanges(req.query.range);
      if (!passages) {
        sendError(res, 400, ErrorCodes.INVALID_PARAM, `range must be 1 to ${MAX_RANGES} verse-id ranges within one book, like 41001001-41001999`);
        return;
      }
      const filter: QuizFilter = {};
      const kinds = listParam(req.query.kind);
      const modes = listParam(req.query.mode);
      if (kinds.length) filter.kinds = kinds;
      if (modes.length) filter.modes = modes;

      const repos = db.getQuizRepos();
      if (repos.length === 0) {
        sendError(res, 404, ErrorCodes.NOT_FOUND, 'No quiz module installed');
        return;
      }
      const seen = new Set<string>();
      const questions: QuizQuestion[] = [];
      for (const repo of repos) {
        if (questions.length >= MAX_QUESTIONS) break;
        for (const q of repo.getQuestions(passages, filter)) {
          if (seen.has(q.key)) continue; // the first module wins a duplicate key
          seen.add(q.key);
          questions.push(q);
          if (questions.length >= MAX_QUESTIONS) break;
        }
      }
      res.set('Cache-Control', QUESTIONS_CACHE_CONTROL);
      res.json({ questions });
    } catch (error) {
      console.error('Error getting quiz questions:', error);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to get quiz questions');
    }
  });

  return router;
}

registerRoute({
  path: '/api/quiz',
  createRoutes: (deps) => createQuizRoutes(deps.db),
});
