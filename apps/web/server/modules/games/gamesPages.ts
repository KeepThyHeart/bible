/**
 * The games page, `/games/play` (phones), `/games/screen` (a second display) and
 * `/games/solo` (task 0115): one HTML entry that loads no reader code. Mounted above the SPA catch-all, like the Presenter's pages.
 * `/games/play/<anything>` serves the same page (the client reads the room code
 * from its own path or query), so a QR code can carry a pretty URL.
 */

import { Router } from 'express';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { registerRoute } from '../../routes/routeRegistry.js';
import { pwaShell } from '../../middleware/serviceWorker.js';

registerRoute({
  path: '/games',
  createRoutes: (deps) => {
    const router = Router();
    const clientDir = deps.extra.clientDir as string | undefined;
    if (!clientDir || !existsSync(clientDir)) return router;
    const pwaEnabled = (deps.extra.pwaEnabled as (() => boolean) | undefined) ?? (() => true);
    const file = join(clientDir, 'games', 'play.html');
    const page = (_req: unknown, res: import('express').Response): void => {
      if (!existsSync(file)) {
        res.status(404).json({ error: 'The games join page is not built' });
        return;
      }
      // It names hashed asset files, so a stale copy pins a phone to a stale build.
      res.set('Cache-Control', 'no-store');
      // Without the PWA the manifest link is stripped (a 404 manifest otherwise), as for the SPA shell.
      res.type('html').send(pwaShell(readFileSync(file, 'utf8'), pwaEnabled()));
    };
    router.get(['/play', '/play/*', '/screen', '/screen/*', '/solo', '/solo/*'], page);
    return router;
  },
});
