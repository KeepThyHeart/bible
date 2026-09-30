/**
 * Serves the Audio Bible files under `/audio`, and nothing else in their directory.
 *
 * Mounted only when `features.audio` is on (see `SiteConfig.audio`). The
 * directory (default `<data dir>/audio`) holds two trees:
 *
 *   v1/{module}/index.json                                 per-translation index (mutable)
 *   v1/{module}/{narrator}/{rev}/{book}/{ccc}.json|.ogg|.mp3   chapter manifest and audio (immutable)
 *   tts/{engine}/...                                       a TTS engine's runtime and voice files
 *
 * Why the server serves them at all: the Content-Security-Policy allows media
 * and fetches from this origin only, so pointing the browser at a CDN would mean
 * loosening it. Serving (or reverse-proxying) the tree under `/audio` keeps the
 * strict default. An operator who does want a CDN sets `audio.base` and the
 * policy is widened for that one origin only (see `cspDirectives.ts`).
 *
 * Range requests (needed to start a chapter file mid-way and to seek) are
 * handled by `express.static`. A missing file is a plain 404 rather than a fall
 * through to the SPA shell, so a client expecting JSON or audio never receives
 * HTML. With no recordings published, every request is a 404, which the client
 * reads as "no recording".
 */

import express, { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';

/** The only top-level directories that are served. */
const ALLOWED_ROOTS = new Set(['v1', 'tts']);

const IMMUTABLE = 'public, max-age=31536000, immutable';
const INDEX_CACHE = 'public, max-age=300';
const ENGINE_FILES_CACHE = 'public, max-age=604800';

export function createAudioRouter(dir: string): Router {
  const router = Router();

  router.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.status(405).set('Allow', 'GET, HEAD').end();
      return;
    }
    // Decode and normalise before matching: `v1/../../etc` must not slip past a
    // prefix test just because express.static would later resolve it.
    let requested: string;
    try {
      requested = decodeURIComponent(req.path);
    } catch {
      res.status(400).end();
      return;
    }
    const segments = requested.replace(/\\/g, '/').split('/').filter(Boolean);
    if (segments.length === 0 || segments.includes('..') || segments.some(s => s.startsWith('.'))) {
      res.status(404).end();
      return;
    }
    if (!ALLOWED_ROOTS.has(segments[0])) {
      res.status(404).end();
      return;
    }
    next();
  });

  router.use(express.static(dir, {
    // A miss is a real 404 (below), not a hand-off to the SPA catch-all.
    fallthrough: false,
    index: false,
    dotfiles: 'ignore',
    setHeaders(res, filePath) {
      const p = filePath.replace(/\\/g, '/');
      if (/\/v1\/[^/]+\/index\.json$/.test(p)) {
        res.set('Cache-Control', INDEX_CACHE);
      } else if (/\/v1\//.test(p)) {
        // The revision is in the path, so these bytes never change.
        res.set('Cache-Control', IMMUTABLE);
      } else {
        res.set('Cache-Control', ENGINE_FILES_CACHE);
      }
      if (p.endsWith('.onnx') || p.endsWith('.data')) res.set('Content-Type', 'application/octet-stream');
      if (p.endsWith('.opus')) res.set('Content-Type', 'audio/ogg; codecs=opus');
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
