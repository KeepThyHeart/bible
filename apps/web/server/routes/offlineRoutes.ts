/**
 * Offline pack manifest and files (task 0075), for the web pack builder.
 *
 *   GET /api/offline/manifest                              an AssetIndex (kth-asset-index/1)
 *   GET /api/offline/files/:id/:version/:name              one module's gzip (immutable, Range, ETag)
 *
 * The manifest lists one asset per module that `/api/modules` would list (the same
 * settings.json filter), so a hidden module is never offered. File URLs are relative
 * to the manifest URL, as in `/assets/v1/index.json`, and `parseAssetIndex` resolves them.
 *
 * Hashes are computed lazily: the first manifest request gzips and hashes every
 * visible module (see `offline/offlineFiles.ts`), at most 2 at a time, and caches the
 * result on disk keyed on each source file's mtime; later requests only stat files.
 * That first call can take seconds to minutes on a large library; it does not block
 * the event loop (async zlib), apart from building a missing Bible lite copy.
 *
 * Warm-up cost (known, not mitigated): there is no background pre-hashing, so the very first
 * manifest request after a cold start (or after source files change) pays for gzip + sha256 of
 * every visible module inline. Run one request after deploy to warm the on-disk cache.
 *
 * Identity trap: the client-visible abbreviation is `entry.shortName || abbr`, exactly
 * what `/api/modules` returns, while lookups use the database abbreviation. The asset id
 * and the file lookup both key on the database abbreviation; `meta.abbreviation` and the
 * file name carry the client one. Clients therefore resolve a module by `meta.abbreviation`
 * first and only then by the derived id, and must use the manifest's real `id`.
 *
 * Cache: files are `private` (everything under /api is password-gated, so a shared cache must
 * not store them), immutable and `no-transform`.
 *
 * Files are sent as application/gzip with `no-transform` and no Content-Encoding, so the
 * compression middleware leaves them alone and the bytes match the declared sha256.
 *
 * 404 unless the `offlineDownloads` or `offlineAutoDownload` site feature is on; the
 * server entry passes that as `extra.offlineEnabled` (boolean or `() => boolean`).
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { DatabaseManager } from '../DatabaseManager.js';
import type { SiteSettings } from '../siteSettings.js';
import { getSettingsKey, getModuleEntry } from '../siteSettings.js';
import { registerRoute } from './routeRegistry.js';
import { isModuleVisible } from './moduleRoutes.js';
import { ensureOfflineFile, safeAbbr } from '../offline/offlineFiles.js';
import type { OfflineFile } from '../offline/offlineFiles.js';
import { sendError, ErrorCodes } from '../utils/errorResponse.js';

const IMMUTABLE = 'private, max-age=31536000, immutable, no-transform';
const HASH_CONCURRENCY = 2;

type ModuleRecord = ReturnType<ReturnType<DatabaseManager['getModuleMetadataRepo']>['getAll']>[number];

interface Candidate {
  mod: ModuleRecord;
  dbAbbr: string;
  id: string;
  clientAbbr: string;
  name: string;
  dbPath: string;
}

function licenseOf(mod: ModuleRecord): string {
  const meta = (mod.metadata ?? {}) as Record<string, unknown>;
  const sword = (mod.swordMetadata ?? {}) as Record<string, unknown>;
  for (const v of [meta.license, meta.License, sword.DistributionLicense, sword.License]) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return 'unspecified';
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export function createOfflineRoutes(
  db: DatabaseManager,
  siteSettings: SiteSettings | null,
  isEnabled: () => boolean,
): Router {
  const router = Router();
  const liteCacheDir = join(db['dataDir'], 'lite-cache');
  if (!existsSync(liteCacheDir)) mkdirSync(liteCacheDir, { recursive: true });

  // Feature gate: indistinguishable from an absent route.
  router.use((_req, res, next) => {
    if (!isEnabled()) {
      sendError(res, 404, ErrorCodes.NOT_FOUND, 'Not found');
      return;
    }
    next();
  });

  /** Visible modules with their ids and client-facing names. Same filter as `/api/modules`. */
  function candidates(): Candidate[] {
    // Fail-safe, as `/api/modules`: no settings.json means nothing is visible.
    if (!siteSettings) return [];
    const seen = new Set<string>();
    const out: Candidate[] = [];
    for (const mod of db.getModuleMetadataRepo().getAll()) {
      if (!isModuleVisible(siteSettings, mod)) continue;
      const dbAbbr = mod.abbreviation || mod.getAbbreviation();
      const id = `module.${safeAbbr(dbAbbr)}`;
      if (seen.has(id)) continue;
      const settingsKey = getSettingsKey(mod.moduleType);
      const entry = settingsKey ? getModuleEntry(siteSettings[settingsKey], dbAbbr) : undefined;
      const clientAbbr = entry?.shortName || dbAbbr;
      const dbPath = db.resolveModulePath(mod.databasePath);
      if (!existsSync(dbPath)) continue;
      seen.add(id);
      out.push({ mod, dbAbbr, id, clientAbbr, name: entry?.title || mod.moduleName, dbPath });
    }
    return out;
  }

  const fileFor = (c: Candidate): Promise<OfflineFile> =>
    ensureOfflineFile({ moduleType: c.mod.moduleType, abbreviation: c.dbAbbr }, { dbPath: c.dbPath, liteCacheDir });

  const versionOf = (f: OfflineFile): string => `s${f.sha256.slice(0, 16)}`;
  const fileName = (c: Candidate): string => `${c.clientAbbr}.db.gz`;

  router.get('/manifest', async (_req: Request, res: Response): Promise<void> => {
    try {
      const cands = candidates();
      const results = await mapLimit(cands, HASH_CONCURRENCY, async (c) => {
        try {
          return await fileFor(c);
        } catch (error) {
          console.warn(`[Offline] Skipping ${c.dbAbbr}:`, error);
          return null;
        }
      });

      const assets = [];
      for (let i = 0; i < cands.length; i++) {
        const c = cands[i];
        const f = results[i];
        if (!f) continue;
        const version = versionOf(f);
        const name = fileName(c);
        assets.push({
          id: c.id,
          kind: 'module',
          version,
          title: c.name,
          license: licenseOf(c.mod),
          size: f.size,
          files: [{
            path: name,
            url: `files/${c.id}/${version}/${encodeURIComponent(name)}`,
            size: f.size,
            sha256: f.sha256,
            contentType: 'application/gzip',
          }],
          meta: {
            moduleType: c.mod.moduleType,
            abbreviation: c.clientAbbr,
            name: c.name,
            languageCode: c.mod.languageCode,
            storedSize: f.storedSize,
            encoding: 'gzip',
          },
        });
      }

      res.setHeader('Cache-Control', 'no-cache');
      res.json({ schema: 'kth-asset-index/1', generatedAt: new Date().toISOString(), assets });
    } catch (error) {
      console.error('Error building offline manifest:', error);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to build offline manifest');
    }
  });

  router.get('/files/:id/:version/:name', async (req: Request, res: Response): Promise<void> => {
    try {
      const { id, version, name } = req.params;
      const c = candidates().find((x) => x.id === id);
      if (!c) { sendError(res, 404, ErrorCodes.NOT_FOUND, 'Not found'); return; }
      const f = await fileFor(c);
      if (version !== versionOf(f) || name !== fileName(c)) {
        sendError(res, 404, ErrorCodes.NOT_FOUND, 'Not found');
        return;
      }
      res.setHeader('Content-Type', 'application/gzip');
      res.setHeader('Cache-Control', IMMUTABLE);
      // Range, If-Range, ETag and Last-Modified come from `send`. No Content-Encoding:
      // these are the literal bytes the manifest's sha256 describes.
      res.sendFile(f.file, { acceptRanges: true, etag: true, lastModified: true, cacheControl: false });
    } catch (error) {
      console.error('Error serving offline file:', error);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to serve offline file');
    }
  });

  return router;
}

registerRoute({
  path: '/api/offline',
  createRoutes: (deps) => {
    const flag = deps.extra.offlineEnabled;
    const isEnabled = typeof flag === 'function' ? (flag as () => boolean) : () => flag === true;
    return createOfflineRoutes(deps.db, deps.siteSettings, isEnabled);
  },
  order: 40,
});
