import express from 'express';
import type { Request, Response, NextFunction, Router } from 'express';
import { existsSync } from 'fs';
import { resolve, basename } from 'path';

/**
 * Static mount for the verse-hover drop-in (`packages/verse-hover`).
 *
 * `/vh/*` serves the built script/CSS/locales; `/vh/data/<TR>/...` serves the
 * generated static Bible JSON. Other sites embed these with a plain
 * `<script src>`, so the responses are cross-origin readable. Helmet defaults
 * `Cross-Origin-Resource-Policy` to same-origin, which would block that; this
 * router runs after helmet and overrides it.
 */

const SEMVER_NAME = /\d+\.\d+\.\d+/;
const CACHE_STABLE = 'public, max-age=86400';
const CACHE_IMMUTABLE = 'public, max-age=31536000, immutable';

export interface VerseHoverMountOptions {
  /** Built verse-hover directory (`packages/verse-hover/dist`). */
  distDir: string;
  /** Generated static Bible JSON; skipped when the directory does not exist. */
  dataDir?: string;
}

/** The dist directory, relative to the web package root (dev and prod alike). */
export function resolveVerseHoverDist(packageRoot: string): string {
  return resolve(packageRoot, '../../packages/verse-hover/dist');
}

function staticOptions(): Parameters<typeof express.static>[1] {
  return {
    dotfiles: 'ignore',
    index: false,
    redirect: false,
    cacheControl: false,
    fallthrough: true,
    setHeaders(res, filePath) {
      const name = basename(filePath);
      res.setHeader('Cache-Control', SEMVER_NAME.test(name) ? CACHE_IMMUTABLE : CACHE_STABLE);
      // A .json.gz is a file, not a transfer encoding: the client sniffs the
      // gzip magic bytes itself, so never label it Content-Encoding: gzip.
      if (name.endsWith('.json.gz')) res.setHeader('Content-Type', 'application/gzip');
      else if (name.endsWith('.json')) res.setHeader('Content-Type', 'application/json; charset=utf-8');
    },
  };
}

function setCrossOriginHeaders(res: Response): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

/**
 * Builds the router to mount at `/vh`, or `null` when the dist directory does
 * not exist (verse-hover was not built), so nothing else is affected.
 */
export function createVerseHoverMount(opts: VerseHoverMountOptions): Router | null {
  if (!existsSync(opts.distDir)) return null;

  const router = express.Router();
  router.use((req: Request, res: Response, next: NextFunction) => {
    // The PHP endpoint ships in dist for the release zip but must never be served as a download.
    if (/\.php$/i.test(req.path)) { res.status(404).end(); return; }
    setCrossOriginHeaders(res);
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Max-Age', '86400');
      res.status(204).end();
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD, OPTIONS');
      res.status(405).end();
      return;
    }
    next();
  });

  if (opts.dataDir && existsSync(opts.dataDir)) {
    router.use('/data', express.static(opts.dataDir, staticOptions()));
  }
  router.use(express.static(opts.distDir, staticOptions()));

  // End here: a miss under /vh must not fall into the SPA fallback.
  router.use((_req: Request, res: Response) => {
    res.status(404).type('text/plain').send('Not found');
  });
  return router;
}
