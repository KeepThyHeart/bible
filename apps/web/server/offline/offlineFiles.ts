/**
 * Offline pack files (task 0075): one gzip per module, produced on demand and
 * cached beside the lite Bible copies.
 *
 *   <lite-cache>/offline/<abbr>.db.gz          the file served to the pack builder
 *   <lite-cache>/offline/<abbr>.db.gz.sha256   `<hex>  <name>` of those gz bytes
 *
 * Bibles are packed from their lite copy (`buildLiteBibleFile`, interlinear-free,
 * the same bytes `/api/modules/:name/download` hands out); every other module type
 * from its source database. Both cache files are keyed on the source file's mtime:
 * either being older than the source means regenerate.
 *
 * Compression is asynchronous (stream pipeline through zlib's threadpool), so a
 * first request for a large module does not stall the event loop. The one
 * synchronous step is building a missing Bible lite copy, which the download
 * routes already do inline.
 *
 * Concurrent callers for the same module share one in-flight promise.
 */

import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync } from 'fs';
import { readFile, rename, rm, writeFile } from 'fs/promises';
import { createGzip } from 'zlib';
import { createHash } from 'crypto';
import { join } from 'path';
import { pipeline } from 'stream/promises';
import { buildLiteBibleFile } from '../routes/moduleRoutes.js';

export interface OfflineModuleRef {
  moduleType: string;
  /** Database abbreviation (`mod.abbreviation || mod.getAbbreviation()`). */
  abbreviation: string;
}

export interface OfflinePaths {
  /** Absolute path of the module's source database. */
  dbPath: string;
  /** The server's `<dataDir>/lite-cache` directory. */
  liteCacheDir: string;
}

export interface OfflineFile {
  /** Absolute path of the `.db.gz`. */
  file: string;
  /** Size of the gz as served. */
  size: number;
  /** Lowercase hex SHA-256 of the gz bytes as served. */
  sha256: string;
  /** Size of the uncompressed database. */
  storedSize: number;
}

const inflight = new Map<string, Promise<OfflineFile>>();

/** File-name-safe form of an abbreviation. */
export function safeAbbr(abbr: string): string {
  return abbr.toLowerCase().replace(/[^a-z0-9._-]/g, '_');
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

async function generate(mod: OfflineModuleRef, paths: OfflinePaths): Promise<OfflineFile> {
  const key = safeAbbr(mod.abbreviation);
  let source = paths.dbPath;
  if (mod.moduleType === 'bible') {
    source = join(paths.liteCacheDir, `${key}-lite.db`);
    buildLiteBibleFile(paths.dbPath, source);
  }
  const srcStat = statSync(source);

  const dir = join(paths.liteCacheDir, 'offline');
  mkdirSync(dir, { recursive: true });
  const gz = join(dir, `${key}.db.gz`);
  const sidecar = `${gz}.sha256`;

  if (existsSync(gz) && existsSync(sidecar)) {
    const gzStat = statSync(gz);
    if (gzStat.mtimeMs >= srcStat.mtimeMs && statSync(sidecar).mtimeMs >= srcStat.mtimeMs) {
      const sha = (await readFile(sidecar, 'utf8')).trim().split(/\s+/)[0] ?? '';
      if (/^[0-9a-f]{64}$/.test(sha)) {
        return { file: gz, size: gzStat.size, sha256: sha, storedSize: srcStat.size };
      }
    }
  }

  const tmp = `${gz}.tmp-${process.pid}`;
  try {
    await pipeline(createReadStream(source), createGzip({ level: 9 }), createWriteStream(tmp));
    const sha256 = await hashFile(tmp);
    await rename(tmp, gz);
    await writeFile(sidecar, `${sha256}  ${key}.db.gz\n`);
    return { file: gz, size: statSync(gz).size, sha256, storedSize: srcStat.size };
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
}

/**
 * Ensure the module's gzip and digest sidecar exist and are current, and return
 * them. Single-flight per module: concurrent calls share one promise.
 */
export function ensureOfflineFile(mod: OfflineModuleRef, paths: OfflinePaths): Promise<OfflineFile> {
  const key = `${paths.liteCacheDir}\0${safeAbbr(mod.abbreviation)}`;
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = generate(mod, paths).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
