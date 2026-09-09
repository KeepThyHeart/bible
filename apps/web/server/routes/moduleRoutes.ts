import { Router, Response } from 'express';
import { join } from 'path';
import { existsSync, statSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { gzipSync } from 'zlib';
import type { Request } from 'express';
import BetterSqlite3 from 'better-sqlite3-web';
import type { DatabaseManager } from '../DatabaseManager.js';
import type { ModuleType } from '@bible/core';
import { validateModuleName } from '../utils/validation.js';
import { sendError, ErrorCodes } from '../utils/errorResponse.js';
import type { SiteSettings } from '../siteSettings.js';
import { getSettingsKey, isModuleActive, getModuleEntry, buildDescriptions, buildSortOrders } from '../siteSettings.js';
import { registerRoute } from './routeRegistry.js';

/** Suffix of the pre-compressed sibling written beside a cached lite copy. */
const GZ_SUFFIX = '.gz';

/**
 * Write `<filePath>.gz` beside a freshly generated lite copy.
 *
 * Compressing in the response path instead would cost ~156 ms of CPU per cold
 * client (gzip level 6 over 6.2 MB runs at ~40 MB/s), which is the wrong shape
 * entirely: the body is identical for every reader and changes only when the
 * module does. The lite copy is already a disk cache keyed on the source's
 * mtime, so its compressed form belongs in the same cache, paid once.
 *
 * Level 9 rather than 6 for the same reason -- at generation time the extra
 * 70 ms buys a slightly smaller file forever. Best-effort: a failure here just
 * means requests fall back to compressing on the fly.
 */
function writeGzSibling(filePath: string): void {
  try {
    writeFileSync(`${filePath}${GZ_SUFFIX}`, gzipSync(readFileSync(filePath), { level: 9 }));
  } catch (error) {
    console.warn('[LiteCache] Could not pre-compress', filePath, error);
  }
}

/**
 * The usable pre-compressed sibling for `filePath`, if there is one.
 *
 * Staleness is judged the same way the lite copy itself is: older than what it
 * was made from means throw it away. Without that check a regenerated module
 * would keep serving the previous edition's bytes.
 */
function freshGzSibling(filePath: string): string | null {
  const gzPath = `${filePath}${GZ_SUFFIX}`;
  if (!existsSync(gzPath)) return null;
  try {
    return statSync(gzPath).mtimeMs >= statSync(filePath).mtimeMs ? gzPath : null;
  } catch {
    return null;
  }
}

function acceptsGzip(req?: Request): boolean {
  return /\bgzip\b/.test(String(req?.headers['accept-encoding'] ?? ''));
}

interface SendDbFileOptions {
  /**
   * Let the compression middleware gzip this response, when no pre-compressed
   * copy is available to send instead.
   *
   * Off by default because `sendDbFile` also serves full modules, which run to
   * hundreds of MB, and gzipping those per request costs CPU in proportion to
   * the largest files we host.
   *
   * The lite Bible copies are the opposite case and worth the exception: KJV
   * measures 6.2 MB raw and 1.8 MB gzipped -- 71% off -- and every reader
   * fetches one in the background on first use, so it is the largest thing a
   * typical visitor downloads.
   */
  compressible?: boolean;
}

function sendDbFile(
  res: Response,
  filePath: string,
  filename: string,
  req?: Request,
  options: SendDbFileOptions = {}
): void {
  // Item #6: Add file size limit (500 MB)
  const MAX_DOWNLOAD_BYTES = 500 * 1024 * 1024;
  const stat = statSync(filePath);
  if (stat.size > MAX_DOWNLOAD_BYTES) {
    res.status(413).json({ error: 'FILE_TOO_LARGE', message: 'Module too large to download directly.' });
    return;
  }

  // Item #6: Set timeout for slow clients (2 minutes)
  if (req) {
    req.socket.setTimeout(120_000);
  }

  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename=${filename}`);

  // Best case: hand over bytes that were compressed once, at generation time.
  // Nothing is spent per request, and `Content-Length` is honest because it
  // describes exactly what goes on the wire.
  const gzPath = options.compressible && acceptsGzip(req) ? freshGzSibling(filePath) : null;
  if (gzPath) {
    // `Vary` so a shared cache cannot hand this body to a client that did not
    // ask for gzip, and vice versa.
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Vary', 'Accept-Encoding');
    res.setHeader('Content-Length', statSync(gzPath).size);
    res.sendFile(gzPath);
    return;
  }

  // Read by `shouldCompress`, which otherwise declines every
  // application/octet-stream response. Set before the body starts so the
  // decision is in place in time.
  if (options.compressible) res.locals.compressible = true;

  // `Content-Length` is deliberately not set when the body may be compressed
  // on the fly: it describes the file on disk, not the bytes on the wire, and
  // announcing the wrong length truncates the download.
  if (!options.compressible) res.setHeader('Content-Length', stat.size);
  res.sendFile(filePath);
}

export function createModuleRoutes(db: DatabaseManager, siteSettings: SiteSettings | null): Router {
  const router = Router();

  router.get('/modules', (_req, res) => {
    try {
      // Fail-safe: no settings.json means no modules visible
      if (!siteSettings) {
        res.json([]);
        return;
      }

      const type = _req.query.type as ModuleType | undefined;
      const repo = db.getModuleMetadataRepo();
      const modules = type ? repo.getByType(type) : repo.getAll();

      const filtered = modules.filter((m) => {
        const abbr = m.abbreviation || m.getAbbreviation();
        if (!abbr) return false;
        const settingsKey = getSettingsKey(m.moduleType);
        // Module types not managed by settings (topical, xref, book, etc.) pass through
        if (!settingsKey) return true;
        return isModuleActive(siteSettings[settingsKey], abbr);
      });

      res.json(filtered.map((m) => {
        const abbr = m.abbreviation || m.getAbbreviation();
        const settingsKey = getSettingsKey(m.moduleType);
        const entry = settingsKey ? getModuleEntry(siteSettings[settingsKey], abbr || '') : undefined;
        return {
          module_id: m.moduleId,
          abbreviation: entry?.shortName || abbr,
          name: entry?.title || m.moduleName,
          type: m.moduleType,
          language_code: m.languageCode,
        };
      }));
    } catch (error) {
      console.error('Error getting modules:', error);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to get modules');
    }
  });

  // Module sections and descriptions for client UI grouping
  router.get('/module-sections', (_req, res) => {
    if (!siteSettings) {
      res.json({ configured: false });
      return;
    }
    res.json({
      configured: true,
      about: siteSettings.about || null,
      bibles: {
        sections: siteSettings.bibles?.sections || [],
        descriptions: buildDescriptions(siteSettings.bibles),
        sortOrders: buildSortOrders(siteSettings.bibles),
      },
      commentaries: {
        sections: siteSettings.commentaries?.sections || [],
        descriptions: buildDescriptions(siteSettings.commentaries),
        sortOrders: buildSortOrders(siteSettings.commentaries),
      },
      dictionaries: {
        sections: siteSettings.dictionaries?.sections || [],
        descriptions: buildDescriptions(siteSettings.dictionaries),
        sortOrders: buildSortOrders(siteSettings.dictionaries),
      },
    });
  });

  router.get('/books', (_req, res) => {
    try {
      const books = db.getBookRepo().getAll();
      res.json(books.map((b) => ({
        book_number: b.bookNumber,
        book_name: b.bookName,
        book_abbreviation: b.bookAbbreviation,
        testament: b.testament,
        chapter_count: b.chapterCount,
      })));
    } catch (error) {
      console.error('Error getting books:', error);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to get books');
    }
  });

  // Download a Bible module DB for offline use
  router.get('/modules/:name/download', (req, res): void => {
    try {
      const name = req.params.name === 'semantic-index' ? 'semantic-index' : validateModuleName(req.params.name);
      if (!name) { sendError(res, 400, ErrorCodes.INVALID_PARAM, 'Invalid module name'); return; }

      // Handle semantic index download
      if (name === 'semantic-index') {
        const semanticPath = join(db['dataDir'], 'semantic_browser.db');
        if (!existsSync(semanticPath)) {
          res.status(404).json({ error: 'Semantic index not available' });
          return;
        }
        sendDbFile(res, semanticPath, 'semantic_browser.db', req);
        return;
      }

      // Look up Bible module
      const repo = db.getModuleMetadataRepo();
      const modules = repo.getAll();
      const mod = modules.find((m) => {
        const abbr = m.abbreviation || m.getAbbreviation();
        return abbr?.toLowerCase() === name.toLowerCase();
      });

      if (!mod) {
        res.status(404).json({ error: 'Module not found' });
        return;
      }

      const dbPath = db.resolveModulePath(mod.databasePath);
      if (!existsSync(dbPath)) {
        res.status(404).json({ error: 'Module database not found' });
        return;
      }

      sendDbFile(res, dbPath, `${name}.db`, req);
    } catch (error) {
      console.error('Error downloading module:', error);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Download failed');
    }
  });

  // Download a lite (reading-only) copy of a Bible module — strips FTS5 indexes and interlinear data.
  // Typical reduction: 17MB → ~2.5MB (85% smaller), KJV 79MB → ~3.5MB (95% smaller).
  // Lite copies are cached to disk after first generation to avoid repeated CPU work.
  const liteCacheDir = join(db['dataDir'], 'lite-cache');
  if (!existsSync(liteCacheDir)) {
    mkdirSync(liteCacheDir, { recursive: true });
  }

  router.get('/modules/:name/download-lite', (req, res): void => {
    try {
      const name = validateModuleName(req.params.name);
      if (!name) { sendError(res, 400, ErrorCodes.INVALID_PARAM, 'Invalid module name'); return; }

      const repo = db.getModuleMetadataRepo();
      const modules = repo.getAll();
      const mod = modules.find((m) => {
        const abbr = m.abbreviation || m.getAbbreviation();
        return abbr?.toLowerCase() === name.toLowerCase();
      });

      if (!mod || mod.moduleType !== 'bible') {
        sendError(res, 404, ErrorCodes.MODULE_NOT_FOUND, 'Bible module not found');
        return;
      }

      const dbPath = db.resolveModulePath(mod.databasePath);
      if (!existsSync(dbPath)) {
        sendError(res, 404, ErrorCodes.NOT_FOUND, 'Module database not found');
        return;
      }

      // Check for cached lite copy (valid if newer than source DB)
      const litePath = join(liteCacheDir, `${name.toLowerCase()}-lite.db`);
      if (existsSync(litePath)) {
        const sourceMtime = statSync(dbPath).mtimeMs;
        const liteMtime = statSync(litePath).mtimeMs;
        if (liteMtime >= sourceMtime) {
          // Backfill the compressed sibling for a cache entry that predates it
          // (or whose source has since been replaced). Costs one request the
          // ~230 ms to build it; every request after this is served from disk
          // with no compression work at all.
          if (!freshGzSibling(litePath)) writeGzSibling(litePath);

          // Serve cached lite copy
          sendDbFile(res, litePath, `${name}-lite.db`, req, { compressible: true });
          return;
        }
      }

      // Generate lite copy: open source DB read-only, copy only essential tables
      const sourceDb = new BetterSqlite3(dbPath, { readonly: true });
      const liteDb = new BetterSqlite3(':memory:');

      try {
        // Copy module_info table
        const moduleInfoSchema = sourceDb.prepare(
          "SELECT sql FROM sqlite_master WHERE type='table' AND name='module_info'"
        ).get() as { sql: string } | undefined;
        if (moduleInfoSchema) {
          liteDb.exec(moduleInfoSchema.sql);
          const rows = sourceDb.prepare('SELECT * FROM module_info').all();
          if (rows.length > 0) {
            const cols = Object.keys(rows[0] as Record<string, unknown>);
            const placeholders = cols.map(() => '?').join(', ');
            const insert = liteDb.prepare(`INSERT INTO module_info (${cols.join(', ')}) VALUES (${placeholders})`);
            for (const row of rows) {
              insert.run(...cols.map(c => (row as Record<string, unknown>)[c]));
            }
          }
        }

        // Copy bible_verse table (the main content)
        const verseSchema = sourceDb.prepare(
          "SELECT sql FROM sqlite_master WHERE type='table' AND name='bible_verse'"
        ).get() as { sql: string } | undefined;
        if (verseSchema) {
          liteDb.exec(verseSchema.sql);
          // Copy in batches to avoid memory spikes on large modules
          const count = (sourceDb.prepare('SELECT COUNT(*) as c FROM bible_verse').get() as { c: number }).c;
          const batchSize = 5000;
          for (let offset = 0; offset < count; offset += batchSize) {
            const batch = sourceDb.prepare(`SELECT * FROM bible_verse ORDER BY verse_id LIMIT ? OFFSET ?`).all(batchSize, offset);
            if (batch.length === 0) break;
            const cols = Object.keys(batch[0] as Record<string, unknown>);
            const placeholders = cols.map(() => '?').join(', ');
            const insert = liteDb.prepare(`INSERT INTO bible_verse (${cols.join(', ')}) VALUES (${placeholders})`);
            const tx = liteDb.transaction(() => {
              for (const row of batch) {
                insert.run(...cols.map(c => (row as Record<string, unknown>)[c]));
              }
            });
            tx();
          }
          // Copy the verse_id index
          const indexes = sourceDb.prepare(
            "SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='bible_verse' AND sql IS NOT NULL"
          ).all() as { sql: string }[];
          for (const idx of indexes) {
            liteDb.exec(idx.sql);
          }
        }

        // Copy schema_version if it exists
        const schemaVersionSchema = sourceDb.prepare(
          "SELECT sql FROM sqlite_master WHERE type='table' AND name='schema_version'"
        ).get() as { sql: string } | undefined;
        if (schemaVersionSchema) {
          liteDb.exec(schemaVersionSchema.sql);
          const rows = sourceDb.prepare('SELECT * FROM schema_version').all();
          if (rows.length > 0) {
            const cols = Object.keys(rows[0] as Record<string, unknown>);
            const placeholders = cols.map(() => '?').join(', ');
            const insert = liteDb.prepare(`INSERT INTO schema_version (${cols.join(', ')}) VALUES (${placeholders})`);
            for (const row of rows) {
              insert.run(...cols.map(c => (row as Record<string, unknown>)[c]));
            }
          }
        }

        // Serialize and cache to disk for future requests
        const buffer = liteDb.serialize();
        writeFileSync(litePath, buffer);
        // Compress once, here, so no request ever pays for it. See writeGzSibling.
        writeGzSibling(litePath);
        console.log(`[LiteCache] Generated ${litePath} (${(buffer.length / 1024 / 1024).toFixed(1)} MB)`);

        sendDbFile(res, litePath, `${name}-lite.db`, req, { compressible: true });
      } finally {
        liteDb.close();
        sourceDb.close();
      }
    } catch (error) {
      console.error('Error creating lite module:', error);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Lite download failed');
    }
  });

  // Get download info for available modules
  router.get('/modules/:name/info', (req, res): void => {
    try {
      const name = req.params.name === 'semantic-index' ? 'semantic-index' : validateModuleName(req.params.name);
      if (!name) { sendError(res, 400, ErrorCodes.INVALID_PARAM, 'Invalid module name'); return; }

      if (name === 'semantic-index') {
        const semanticPath = join(db['dataDir'], 'semantic_browser.db');
        if (!existsSync(semanticPath)) {
          res.json({ available: false });
          return;
        }
        const stat = statSync(semanticPath);
        res.json({ available: true, sizeBytes: stat.size, name: 'Semantic Search Index' });
        return;
      }

      const repo = db.getModuleMetadataRepo();
      const modules = repo.getAll();
      const mod = modules.find((m) => {
        const abbr = m.abbreviation || m.getAbbreviation();
        return abbr?.toLowerCase() === name.toLowerCase();
      });

      if (!mod) {
        res.json({ available: false });
        return;
      }

      const dbPath = db.resolveModulePath(mod.databasePath);
      if (!existsSync(dbPath)) {
        res.json({ available: false });
        return;
      }

      const stat = statSync(dbPath);
      res.json({
        available: true,
        sizeBytes: stat.size,
        name: mod.moduleName,
        abbreviation: mod.abbreviation || mod.getAbbreviation(),
        type: mod.moduleType,
      });
    } catch (error) {
      console.error('Error getting module info:', error);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to get module info');
    }
  });

  return router;
}

registerRoute({
  path: '/api',
  createRoutes: (deps) => createModuleRoutes(deps.db, deps.siteSettings),
  order: 50,
});
