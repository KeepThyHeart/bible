/**
 * Serves the downloadable asset store under `/assets/v1` (task 0090), read-only.
 *
 *   v1/index.json                                   generated catalogue (mutable, revalidated)
 *   v1/<kind>/<id>/<version>/<path...>              asset files (immutable: the version is in the path)
 *   v1/<kind>/<id>/<version>/<path...>.sha256       digest sidecar, `<hex>  <name>`
 *
 * Range / If-Range / ETag come from `express.static` (`send`). Responses carry
 * `no-transform` so the gzip middleware never re-encodes them: that would break
 * Range and the exact byte sizes the client verifies.
 *
 * Only `/v1/...` is claimed. The client build's hashed bundles also live under
 * `/assets/` (Vite's default), so any other path falls through with `next()` to
 * the static handler further down. Inside `/v1` a miss is a plain JSON 404,
 * never the SPA shell. No feature flag: an empty or missing directory just 404s.
 */

import express, { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';

const IMMUTABLE = 'public, max-age=31536000, immutable, no-transform';
const INDEX_CACHE = 'no-cache, no-transform';

export function createAssetRouter(dir: string): Router {
  const router = Router();

  router.use((req: Request, res: Response, next: NextFunction) => {
    let requested: string;
    try {
      requested = decodeURIComponent(req.path);
    } catch {
      res.status(400).end();
      return;
    }
    const segments = requested.replace(/\\/g, '/').split('/').filter(Boolean);
    // Not ours: the client build's `/assets/<hash>.js` etc.
    if (segments[0] !== 'v1') {
      next('router');
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.status(405).set('Allow', 'GET, HEAD').end();
      return;
    }
    // Empty segments (`//`) and dot segments are refused, not normalised.
    const raw = requested.replace(/\\/g, '/').split('/').slice(1);
    const bad = segments.includes('..') || segments.some(s => s.startsWith('.')) || raw.some(s => s === '');
    const isIndex = segments.length === 2 && segments[1] === 'index.json';
    if (bad || !(isIndex || segments.length >= 5)) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    next();
  });

  router.use(express.static(dir, {
    fallthrough: false,
    index: false,
    dotfiles: 'ignore',
    etag: true,
    lastModified: true,
    setHeaders(res, filePath) {
      const p = filePath.replace(/\\/g, '/');
      res.set('Cache-Control', p.endsWith('/v1/index.json') ? INDEX_CACHE : IMMUTABLE);
      if (p.endsWith('.sha256')) res.set('Content-Type', 'text/plain; charset=utf-8');
      else if (/\.(onnx|bin|data|db)$/.test(p)) res.set('Content-Type', 'application/octet-stream');
    },
  }));

  router.use((
    err: NodeJS.ErrnoException & { statusCode?: number },
    _req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR' || err.statusCode === 404)) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    next(err);
  });

  return router;
}
