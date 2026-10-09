/**
 * The content database as a data asset.
 *
 * `content-src/` (curated verses, prompt cards, the facts the generator builds
 * questions from) is the source; `<state dir>/games/content.db` is the build.
 * `ensureContentDatabase` rebuilds it when it is missing or when the sources
 * changed (a digest is stored beside it), so a deploy that ships new content
 * needs no manual step and a restart with unchanged content costs one hash.
 * Nothing is written into the source tree, and the database is built beside
 * the old one and renamed over it, so a crash never leaves a half-built file.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { ContentDatabase } from './ContentDatabase.js';
import { generate } from './generator/generate.js';
import { readSources } from './generator/sources.js';
import type { RawSources } from './generator/sources.js';
import { importContent, importCsv } from './importer.js';
import type { ImportReport } from './importer.js';

/** Bump when the importer, generator or schema changes in a way that changes the built database. */
export const BUILD_VERSION = 1;

/** One file per list, each holding a key of the same name: `people.json` holds `people`. */
const SOURCE_LISTS = ['people', 'places', 'sayings', 'timelines', 'board'] as const;

/** Directories of authored files imported as they are, in this order. */
const AUTHORED_DIRS = ['verses', 'prompt-cards'] as const;

export interface BuildResult {
  reports: ImportReport[];
  /** Generator problems; when any, nothing generated was imported. */
  problems: string[];
}

function filesIn(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => ['.csv', '.json'].includes(extname(name).toLowerCase()))
    .sort()
    .map((name) => join(dir, name));
}

/** Digest of everything the build reads, so a change in any source file triggers a rebuild. */
export function contentSourceDigest(sourceDir: string): string {
  const hash = createHash('sha256');
  for (const dir of [...AUTHORED_DIRS, 'source']) {
    for (const file of filesIn(join(sourceDir, dir))) {
      hash.update(`${BUILD_VERSION}:${dir}/${basename(file)}|`);
      hash.update(readFileSync(file));
    }
  }
  return hash.digest('hex');
}

/** Questions built from `source/`, as import payloads, plus anything the generator rejected. */
export function generatePayloads(sourceDir: string): { payloads: unknown[]; problems: string[] } {
  const raw: RawSources = {};
  for (const name of SOURCE_LISTS) {
    const path = join(sourceDir, 'source', `${name}.json`);
    if (!existsSync(path)) continue;
    raw[name] = (JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>)[name];
  }
  const { sources, problems } = readSources(raw);
  if (problems.length > 0) {
    return { payloads: [], problems: problems.map((p) => `[${p.kind}] ${p.item}: ${p.detail}`) };
  }
  return {
    payloads: generate(sources).map((file) => ({
      questions: file.questions,
      sets: file.sets,
      orderedLists: file.orderedLists,
    })),
    problems: [],
  };
}

/** Fill an open database from the sources. */
export function populateContentDatabase(db: ContentDatabase, sourceDir: string): BuildResult {
  const reports: ImportReport[] = [];
  for (const dir of AUTHORED_DIRS) {
    for (const file of filesIn(join(sourceDir, dir))) {
      const text = readFileSync(file, 'utf8');
      reports.push(
        extname(file).toLowerCase() === '.csv'
          ? importCsv(db, text)
          : importContent(db, JSON.parse(text) as unknown)
      );
    }
  }
  const { payloads, problems } = generatePayloads(sourceDir);
  for (const payload of payloads) reports.push(importContent(db, payload));
  return { reports, problems };
}

/**
 * Make sure `dbPath` holds a database built from the current sources, and
 * return what (if anything) was rebuilt. Returns null when it was up to date.
 */
export function ensureContentDatabase(sourceDir: string, dbPath: string): BuildResult | null {
  const digestPath = `${dbPath}.digest`;
  const digest = contentSourceDigest(sourceDir);
  if (existsSync(dbPath) && existsSync(digestPath) && readFileSync(digestPath, 'utf8').trim() === digest) {
    return null;
  }
  mkdirSync(join(dbPath, '..'), { recursive: true });
  const tmp = `${dbPath}.building`;
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${tmp}${suffix}`, { force: true });
  const db = ContentDatabase.open(tmp);
  const result = populateContentDatabase(db, sourceDir);
  db.close();
  for (const suffix of ['-wal', '-shm']) rmSync(`${dbPath}${suffix}`, { force: true });
  renameSync(tmp, dbPath);
  rmSync(`${tmp}-wal`, { force: true });
  rmSync(`${tmp}-shm`, { force: true });
  writeFileSync(digestPath, `${digest}\n`);
  return result;
}
