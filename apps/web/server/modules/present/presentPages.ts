/**
 * The Presenter's HTML entry points (moved from server/index.ts, task 0123):
 * `/present/v/:joinCode` (projection viewer), `/present/solo` and `/watch`.
 *
 * They are second HTML entry points, not routes inside the reading app, and
 * must be mounted above the SPA catch-all or it answers the same URLs with the
 * reading app's shell (a 200 with HTML). The join code is not validated here:
 * answering differently for a real code than a made-up one would leak which
 * codes exist. Served only when the client build directory exists
 * (`deps.extra.clientDir`).
 */

import { Router } from 'express';
import { existsSync } from 'fs';
import { join } from 'path';
import { registerRoute } from '../../routes/routeRegistry.js';

function pageRoute(file: string, missing: string) {
  return (_req: unknown, res: import('express').Response): void => {
    if (!existsSync(file)) {
      res.status(404).json({ error: missing });
      return;
    }
    // It names hashed asset files, so a stale copy pins this screen to a stale build.
    res.set('Cache-Control', 'no-store');
    res.sendFile(file);
  };
}

registerRoute({
  path: '/present',
  createRoutes: (deps) => {
    const router = Router();
    const clientDir = deps.extra.clientDir as string | undefined;
    if (!clientDir || !existsSync(clientDir)) return router;
    router.get('/v/:joinCode', pageRoute(join(clientDir, 'present', 'viewer.html'), 'Projection viewer is not built'));
    router.get('/solo', pageRoute(join(clientDir, 'present', 'solo.html'), 'The solo viewer is not built'));
    return router;
  },
});

registerRoute({
  path: '/watch',
  createRoutes: (deps) => {
    const router = Router();
    const clientDir = deps.extra.clientDir as string | undefined;
    if (!clientDir || !existsSync(clientDir)) return router;
    router.get('/', pageRoute(join(clientDir, 'present', 'watch.html'), 'The join page is not built'));
    return router;
  },
});
