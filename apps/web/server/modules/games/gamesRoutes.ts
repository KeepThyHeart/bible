/**
 * Mounts the games API at `/api/games` (task 0115).
 *
 * Bible text comes from the host's `DatabaseManager` (the same translations the
 * reader shows, honouring the site's visibility settings). The authored content
 * (curated verses, questions, prompt cards) lives in a small database of the
 * games' own, built from `content-src/` into the instance's state directory the
 * first time and whenever the sources change.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Router } from 'express';
import { registerRoute } from '../../routes/routeRegistry.js';
import { isModuleActive } from '../../siteSettings.js';
import { logger } from '../../utils/logger.js';
import { config } from './config.js';
import { ContentDatabase } from './content/ContentDatabase.js';
import { DatabaseManagerCatalog } from './content/DatabaseManagerCatalog.js';
import { ensureContentDatabase } from './content/build.js';
import { ContentLibrary, useContent } from './content/index.js';
import { createGamesRouter } from './routes/index.js';

/** Where the authored content sources sit: beside this file in source and in a build. */
export const CONTENT_SRC_DIR = join(import.meta.dirname, 'content-src');

registerRoute({
  path: '/api/games',
  createRoutes: (deps) => {
    // A content problem (bad JSON in the sources, an unwritable state directory) must not stop the
    // reader from booting: the games API then answers 503 and says why in the log.
    try {
      const appStateDir = (deps.extra.appStateDir as string | undefined) ?? 'data';
      const dbPath = join(appStateDir, 'games', 'content.db');
      mkdirSync(dirname(dbPath), { recursive: true });

      if (existsSync(CONTENT_SRC_DIR)) {
        const built = ensureContentDatabase(CONTENT_SRC_DIR, dbPath);
        if (built) {
          for (const problem of built.problems) logger.warn(`[games] content: ${problem}`);
          logger.info(`[games] content database built at ${dbPath}`);
        }
      }

      const siteSettings = deps.siteSettings;
      const catalog = new DatabaseManagerCatalog(deps.db, {
        isVisible: siteSettings ? (abbreviation) => isModuleActive(siteSettings.bibles, abbreviation) : undefined,
      });
      useContent(ContentLibrary.of(catalog, ContentDatabase.open(dbPath), config.defaultTranslation));
      // Strict unless the site says otherwise: strict keeps answer text on this server.
      return createGamesRouter({ privacyMode: deps.extra.privacyMode === 'relaxed' ? 'relaxed' : 'strict' });
    } catch (error) {
      logger.error(`[games] disabled: could not start (${error instanceof Error ? error.message : String(error)})`);
      const router = Router();
      router.use((_req, res) => {
        res.status(503).json({ error: { code: 'GAMES_UNAVAILABLE', message: 'Games could not start on this server.' } });
      });
      return router;
    }
  },
});
