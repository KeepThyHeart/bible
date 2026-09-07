import { Router } from 'express';
import type { DatabaseManager } from '../DatabaseManager.js';
import { sendError, ErrorCodes } from '../utils/errorResponse.js';
import { registerRoute } from './routeRegistry.js';

/**
 * Study overview routes — serves pre-generated study cache data.
 *
 * The cache is built by `generate-study-cache.js` (not in this repo) and contains
 * commentary overviews, topics, cross-references, and tag graph entities
 * for every chapter of the Bible. This eliminates expensive per-verse SQL
 * queries at runtime.
 *
 * Endpoint:
 *   GET /api/study/overview/:book/:chapter
 *
 * Returns a single JSON object with all study data for the chapter:
 *   {
 *     commentary: [...],   // Commentary entry metadata (module, level, wordCount, range)
 *     topics: { ... },     // Topics per verse ID
 *     crossrefs: { ... },  // Cross-ref groups per verse ID
 *     entities: { ... },   // Tag graph entities per verse ID
 *     cached: true         // Indicates data came from static cache
 *   }
 *
 * Falls back to empty data if the cache has not been generated.
 */

/** One cached topic entry, as written by `generate-study-cache.js` (not in this repo). */
interface CachedTopic {
  id: number;
  n: string;
  /** Ancestor chain as a display string ("Gifts From God > SPIRITUAL"). */
  p?: string;
  /** Ancestors root-first as `[topicId, name, recursiveVerseCount]`. */
  a?: [number, string, number][];
  vc: number;
  src: string;
  sn: string;
  d?: string;
}

/**
 * Give id-less ancestors their ids back.
 *
 * `a` (ancestor ids) was added to the cache format after `p` (the pre-joined
 * display string). A cache generated before that carries `p` only, and the
 * client cannot invent the ids: a name identifies nothing — hundreds of Nave's
 * topics are called "History of", one under each parent — so the breadcrumb
 * renders every ancestor as dead plain text and only the leaf as a link. That
 * is the "only the last crumb is clickable" report.
 *
 * Rather than make the reader regenerate the cache, resolve the chain from the
 * topical module here. Modern caches already carry `a`, so the loop below is a
 * pair of property checks per topic and nothing else. An ancestor whose module
 * is not installed stays id-less on purpose — it could not be opened anyway.
 */
function backfillAncestorIds(db: DatabaseManager, topicsByVerse: Record<string, CachedTopic[]>): void {
  const chains = new Map<string, [number, string, number][]>();

  for (const topics of Object.values(topicsByVerse)) {
    for (const topic of topics) {
      if (topic.a || !topic.p) continue;

      const key = `${topic.src}:${topic.id}`;
      let chain = chains.get(key);
      if (!chain) {
        const repo = db.getTopicalIndexRepo(topic.src);
        chain = repo
          ? repo.getParentChain(topic.id).flatMap((ancestor): [number, string, number][] =>
              ancestor.topicId === undefined
                ? []
                : [[ancestor.topicId, ancestor.name, repo.getRecursiveVerseCount(ancestor.topicId)]]
            )
          : [];
        chains.set(key, chain);
      }
      if (chain.length > 0) topic.a = chain;
    }
  }
}

export function createStudyOverviewRoutes(db: DatabaseManager): Router {
  const router = Router();

  router.get('/:book/:chapter', (req, res): void => {
    try {
      const book = Number(req.params.book);
      const chapter = Number(req.params.chapter);

      if (!Number.isInteger(book) || book < 1 || book > 66) {
        sendError(res, 400, ErrorCodes.INVALID_PARAM, 'Invalid book number');
        return;
      }
      if (!Number.isInteger(chapter) || chapter < 1) {
        sendError(res, 400, ErrorCodes.INVALID_PARAM, 'Invalid chapter number');
        return;
      }

      const cacheDb = db.getStudyCacheDb();
      if (!cacheDb) {
        // No cache — return empty structure
        res.json({
          commentary: [],
          topics: {},
          crossrefs: {},
          entities: {},
          cached: false,
        });
        return;
      }

      const row = cacheDb.queryOne<{
        commentary_overview: string;
        topics: string;
        crossrefs: string;
        entities: string;
      }>(
        'SELECT commentary_overview, topics, crossrefs, entities FROM study_cache WHERE book = ? AND chapter = ?',
        [book, chapter]
      );

      if (!row) {
        res.json({
          commentary: [],
          topics: {},
          crossrefs: {},
          entities: {},
          cached: true,
        });
        return;
      }

      // Study overview is pre-generated and only changes when modules change.
      // Cache aggressively in the browser.
      res.set('Cache-Control', 'public, max-age=86400');

      const topics = JSON.parse(row.topics) as Record<string, CachedTopic[]>;
      backfillAncestorIds(db, topics);

      res.json({
        commentary: JSON.parse(row.commentary_overview),
        topics,
        crossrefs: JSON.parse(row.crossrefs),
        entities: JSON.parse(row.entities),
        cached: true,
      });
    } catch (error) {
      console.error('Error getting study overview:', error);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to get study overview');
    }
  });

  return router;
}

registerRoute({
  path: '/api/study/overview',
  createRoutes: (deps) => createStudyOverviewRoutes(deps.db),
});
