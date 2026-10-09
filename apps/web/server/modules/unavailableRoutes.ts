/**
 * The off switch's other half (task 0123): when a server feature module is
 * disabled, every path its manifest declares in `contributes.serverRoutes`
 * answers "not available" instead of falling through to the SPA shell or a
 * bare 404. JSON for API/fetch callers, a minimal HTML page for navigations.
 */

import { Router } from 'express';
import type { RequestHandler } from 'express';
import { listServerModules } from './loadServerModules.js';

const MESSAGE = 'This feature is not available on this server.';

export function unavailableHandler(feature: string): RequestHandler {
  return (req, res) => {
    res.status(404);
    res.set('Cache-Control', 'no-store');
    if (req.accepts(['json', 'html']) === 'html') {
      res.type('html').send(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
          `<title>Not available</title></head><body style="font-family:sans-serif;margin:2rem"><p>${MESSAGE}</p></body></html>`,
      );
      return;
    }
    res.json({ error: { code: 'FEATURE_UNAVAILABLE', message: MESSAGE, feature } });
  };
}

/** Disabled server modules with the paths they declare. */
export function disabledServerModulePaths(): Array<{ id: string; paths: string[] }> {
  return listServerModules()
    .filter((m) => !m.enabled)
    .map((m) => ({
      id: m.id,
      paths: [...new Set((m.manifest.contributes.serverRoutes ?? []).map((r) => r.path).filter((p): p is string => !!p))],
    }));
}

/** One router answering 404 for every path of every disabled module. Mount after auth, before the SPA catch-all. */
export function createUnavailableRoutes(): Router {
  const router = Router();
  for (const { id, paths } of disabledServerModulePaths()) {
    for (const p of paths) router.use(p, unavailableHandler(id));
  }
  return router;
}
