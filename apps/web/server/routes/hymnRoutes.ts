/**
 * The hymn library over HTTP.
 *
 * Under `/api/hymns` rather than `/api/present/hymns`, and without a join code,
 * because a hymn is *content* -- the same kind of thing as a chapter of
 * Scripture, which this server already serves to anyone who can reach it. The
 * presenter is the first consumer, not the only conceivable one; a hymns pane
 * in the reading app would use exactly these two routes.
 *
 * Everything served here is public domain by construction: the parser refuses
 * to admit a file that does not say so.
 */

import { Router } from 'express';
import { sendError, ErrorCodes } from '../utils/errorResponse.js';
import { registerRoute } from './routeRegistry.js';
import { logger } from '../utils/logger.js';
import { HymnLibrary } from '../present/hymns/HymnLibrary.js';

/** Cap on how many results one query returns, whatever it asks for. */
const MAX_LIMIT = 100;

export interface HymnRouteOptions {
  library: HymnLibrary;
}

export function createHymnRoutes(options: HymnRouteOptions): Router {
  const router = Router();
  const { library } = options;

  /**
   * Search, or browse when nothing is typed.
   *
   * An empty query listing the library is what makes the controller's hymn
   * picker useful before the presenter knows what they are looking for.
   */
  router.get('/', (req, res): void => {
    const query = typeof req.query.q === 'string' ? req.query.q.slice(0, 200) : '';
    const asked = Number(req.query.limit);
    const limit = Number.isInteger(asked) && asked > 0 ? Math.min(asked, MAX_LIMIT) : undefined;

    res.json(query.trim() ? library.search(query, limit) : library.all(limit));
  });

  router.get('/:id', (req, res): void => {
    const { id } = req.params;

    /**
     * `verse-order` may be overridden per request: the file's own order is a
     * default, not a constraint, and a service that sings only verses one and
     * four is entirely ordinary. Ordering lives in the query rather than the
     * stored hymn so the library file stays the same for everyone.
     */
    const requested = typeof req.query.order === 'string'
      ? req.query.order.trim().split(/\s+/).filter(Boolean)
      : undefined;
    if (requested && !requested.every(token => /^(\d{1,3}|[RBCI])$/.test(token))) {
      sendError(res, 400, ErrorCodes.INVALID_PARAM, 'Invalid verse order');
      return;
    }

    const detail = library.detail(id, requested);
    if (!detail) {
      sendError(res, 404, ErrorCodes.NOT_FOUND, 'Hymn not found');
      return;
    }

    // Hymn text does not change between deployments, and the viewer may be on a
    // connection that struggles. This is the one thing in the presenter path
    // that is safe to cache hard.
    res.set('Cache-Control', 'public, max-age=3600');
    res.json(detail);
  });

  return router;
}

/**
 * Load the library once at startup.
 *
 * A module-level singleton because the route factory may be called more than
 * once (tests mount their own router) and re-reading several hundred files per
 * mount would be waste. Failures are logged and survivable: a hymn library is
 * optional, and a malformed contribution must not stop a service starting.
 */
let shared: HymnLibrary | null = null;

export function sharedHymnLibrary(dirs: string[]): HymnLibrary {
  if (shared) return shared;

  shared = new HymnLibrary();
  for (const dir of dirs) {
    const report = shared.load(dir);
    if (report.loaded > 0) logger.info(`[hymns] loaded ${report.loaded} hymn(s) from ${dir}`);
    for (const failure of report.failed) {
      logger.warn(`[hymns] ${failure.file}: ${failure.errors.map(e => `line ${e.line}: ${e.message}`).join('; ')}`);
    }
    for (const warned of report.warnings) {
      logger.warn(`[hymns] ${warned.file}: ${warned.warnings.map(w => `line ${w.line}: ${w.message}`).join('; ')}`);
    }
  }
  return shared;
}

registerRoute({
  path: '/api/hymns',
  createRoutes: (deps) => createHymnRoutes({
    library: sharedHymnLibrary(deps.extra.hymnDirs as string[]),
  }),
});
