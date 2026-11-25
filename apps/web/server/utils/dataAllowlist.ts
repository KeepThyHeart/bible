/**
 * Allowlist guard for the public `/data` static mount.
 *
 * Only the browser-side search assets may be served from the data directory:
 * `models/**` and `semantic_*.bin|json`. Everything else is a 404 -- notably
 * `site-config.json`, the module databases, and the write-only report folders
 * (`feedback/`, `desktop-reports/`), which must never be readable from the web.
 */

import type { Request, Response, NextFunction } from 'express';

const SEMANTIC_ASSET = /^semantic_[A-Za-z0-9._-]+\.(bin|json)$/;

export function dataAllowlist(req: Request, res: Response, next: NextFunction): void {
  // Normalise before matching: `models/../main.db` resolves inside the static
  // root, so a prefix test alone would let it through.
  let requested: string;
  try {
    requested = decodeURIComponent(req.path);
  } catch {
    res.status(400).end();
    return;
  }
  const segments = requested.replace(/\\/g, '/').split('/').filter(Boolean);
  if (segments.includes('..') || segments.length === 0) {
    res.status(404).end();
    return;
  }
  const isModelAsset = segments[0] === 'models';
  const isSemanticAsset = segments.length === 1 && SEMANTIC_ASSET.test(segments[0]);
  if (!isModelAsset && !isSemanticAsset) {
    res.status(404).end();
    return;
  }
  next();
}
