import { Router } from 'express';
import type { TimelineDataset } from '@bible/core/browser';
import type { DatabaseManager } from '../DatabaseManager.js';
import { sendError, ErrorCodes } from '../utils/errorResponse.js';
import { registerRoute } from './routeRegistry.js';

/**
 * The dataset is static for the life of an installed module version, so one
 * response is cached in memory and served with an ETag (Express derives it
 * from the body, so `If-None-Match` yields a 304) and a long-ish max-age.
 */
const CACHE_CONTROL = 'private, max-age=3600, stale-while-revalidate=86400';

export function createTimelineRoutes(db: DatabaseManager, options?: { enabled?: boolean }): Router {
  const router = Router();
  const enabled = options?.enabled ?? true;
  let cached: TimelineDataset | null = null;

  // The whole timeline module as one JSON document.
  router.get('/', (_req, res): void => {
    try {
      if (!enabled) {
        sendError(res, 404, ErrorCodes.NOT_FOUND, 'Timeline is disabled');
        return;
      }
      if (!cached) {
        const repo = db.getTimelineRepo();
        if (!repo) {
          sendError(res, 404, ErrorCodes.NOT_FOUND, 'No timeline module installed');
          return;
        }
        cached = repo.getDataset();
      }
      res.set('Cache-Control', CACHE_CONTROL);
      res.json(cached);
    } catch (error) {
      console.error('Error getting timeline dataset:', error);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to get timeline');
    }
  });

  return router;
}

registerRoute({
  path: '/api/timeline',
  createRoutes: (deps) => createTimelineRoutes(deps.db, { enabled: (deps.extra.showTimeline as boolean | undefined) ?? true }),
});
