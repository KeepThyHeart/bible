import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { Router } from 'express';
import type { Response } from 'express';

/**
 * The server half of the PWA switch (`features.pwa`).
 *
 * The client build always contains two workers: the real `sw.js` and the kill
 * switch `sw-kill.js`. This router decides, per request, which one a browser is
 * handed at `/sw.js`. Browsers re-fetch the worker script on every navigation
 * and bypass the HTTP cache for it, so flipping the flag and restarting the
 * server reaches every installed client on its next visit, including one too
 * wedged to run any app code. That is the whole point of doing it here rather
 * than in the page.
 *
 * With the flag off the manifest is withheld as well, and `pwaShell` strips its
 * `<link>`, so the site is no longer installable.
 */

export interface ServiceWorkerOptions {
  /** Directory holding the built client (`dist/client`). */
  clientDir: string;
  /** Read per request so a test (or a future runtime toggle) can change it. */
  isPwaEnabled: () => boolean;
}

/** Never cached anywhere: the replacement worker must always be reachable. */
function sendScript(res: Response, file: string): void {
  res.set('Cache-Control', 'no-store');
  res.type('application/javascript');
  res.sendFile(file);
}

export function createServiceWorkerRoutes({ clientDir, isPwaEnabled }: ServiceWorkerOptions): Router {
  const router = Router();
  const workerFile = join(clientDir, 'sw.js');
  const killFile = join(clientDir, 'sw-kill.js');

  router.get('/sw.js', (_req, res, next) => {
    const file = isPwaEnabled() ? workerFile : killFile;
    if (!existsSync(file)) return next();
    sendScript(res, file);
  });

  // Always the kill worker, whatever the flag says: lets an operator (or a
  // support script) point a browser at it explicitly.
  router.get('/sw-kill.js', (_req, res, next) => {
    if (!existsSync(killFile)) return next();
    sendScript(res, killFile);
  });

  router.get('/manifest.webmanifest', (_req, res, next) => {
    if (isPwaEnabled()) return next();
    res.status(404).json({ error: 'The PWA is disabled on this server' });
  });

  return router;
}

const MANIFEST_LINK = /<link\b[^>]*\brel=["']manifest["'][^>]*>\s*/gi;

/** `index.html` with the manifest link removed unless the PWA is on. */
export function pwaShell(html: string, pwaEnabled: boolean): string {
  return pwaEnabled ? html : html.replace(MANIFEST_LINK, '');
}

let shellCache: { path: string; mtimeMs: number; html: string } | null = null;

/** Read `index.html`, re-reading only when the file changes. */
export function readShell(indexPath: string): string {
  const { mtimeMs } = statSync(indexPath);
  if (!shellCache || shellCache.path !== indexPath || shellCache.mtimeMs !== mtimeMs) {
    shellCache = { path: indexPath, mtimeMs, html: readFileSync(indexPath, 'utf-8') };
  }
  return shellCache.html;
}
