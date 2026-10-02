#!/usr/bin/env bun
/**
 * Build the trimmed KJV that `@bible/cli` embeds in its executable.
 *
 *   bun scripts/build-kjv.ts [--source=<path>] [--out=<path>]
 *
 * The output is an ordinary module file: verses, formatting, `module_info`,
 * `schema_version`, the FTS5 index and the empty search-cache tables. Only the
 * tables in `DROP_TABLES` (and their indexes) are removed; the CLI never reads
 * them and they are most of the file's size.
 *
 * The schema is inherited, never re-declared: the build copies the real module
 * and deletes from it, so it cannot drift from the module format the rest of
 * the project uses.
 *
 * Runs on `bun:sqlite`, so it needs no native npm module.
 */
import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const PKG_DIR = join(import.meta.dir, '..');
const DEFAULT_SOURCE = join(PKG_DIR, '..', '..', 'data', 'modules', 'bible_kjv.db');
const DEFAULT_OUT = join(PKG_DIR, 'src', 'assets', 'bible_kjv.db');

/** Dropped entirely; dropping a table drops its indexes with it. */
const DROP_TABLES = ['interlinear_word'];

/**
 * Kept but emptied. `ensureBookSearchIndex()` fills these in on demand at the
 * first proximity search, so they must exist, but shipping their contents would
 * be shipping a cache.
 */
const EMPTY_TABLES = ['book_search_index', 'book_search_metadata', 'verse_positions'];

/** A phrase query the module must answer. */
const PHRASE_CHECK = { query: '"everlasting life"', expected: 11 };

function arg(name: string, fallback: string): string {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
}

const mb = (path: string): string => (statSync(path).size / 1024 / 1024).toFixed(1);

function tableNames(db: Database): Set<string> {
  const rows = db
    .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all();
  return new Set(rows.map((r) => r.name));
}

function count(db: Database, sql: string): number | undefined {
  return db.query<{ n: number }, []>(sql).get()?.n;
}

function main(): number {
  const source = resolve(arg('source', DEFAULT_SOURCE));
  const out = resolve(arg('out', DEFAULT_OUT));
  const temp = `${out}.tmp`;

  if (!existsSync(source)) {
    process.stderr.write(
      `build-kjv: source module not found: ${source}\n` +
        '           pass --source=<path> to a bible_kjv.db\n',
    );
    return 1;
  }

  mkdirSync(dirname(out), { recursive: true });
  rmSync(temp, { force: true });

  process.stdout.write(`source ${source} (${mb(source)} MB)\n`);

  // `VACUUM INTO` produces a clean, defragmented copy with no WAL sidecar,
  // without writing a byte to the source. Shipped modules are in WAL mode, so
  // copying the file alone could miss committed frames still sitting in the
  // -wal.
  const reader = new Database(source, { readonly: true });
  reader.run(`VACUUM INTO '${temp.replace(/'/g, "''")}'`);
  reader.close();

  const db = new Database(temp);
  const present = tableNames(db);

  for (const table of DROP_TABLES) {
    if (present.has(table)) {
      db.run(`DROP TABLE ${table}`);
      process.stdout.write(`  dropped ${table}\n`);
    }
  }

  for (const table of EMPTY_TABLES) {
    if (present.has(table)) {
      db.run(`DELETE FROM ${table}`);
    } else {
      process.stderr.write(
        `  WARNING: ${table} is missing from the source module. ` +
          'ensureBookSearchIndex() will have to create it, which fails on a ' +
          'read-only copy, so proximity search would degrade.\n',
      );
    }
  }

  // Reclaim the pages the dropped table was using.
  db.run('VACUUM');
  db.close();

  rmSync(out, { force: true });
  renameSync(temp, out);

  return check(out);
}

/** Verify the trimmed file is still a working module before shipping it. */
function check(path: string): number {
  const db = new Database(path, { readonly: true });
  const failures: string[] = [];

  const verses = count(db, 'SELECT count(*) AS n FROM bible_verse');
  if (verses === undefined || verses < 31_000) {
    failures.push(`expected ~31102 verses, found ${verses}`);
  }

  const phrase = count(
    db,
    `SELECT count(*) AS n FROM bible_verse_fts WHERE bible_verse_fts MATCH '${PHRASE_CHECK.query.replace(/'/g, "''")}'`,
  );
  if (phrase !== PHRASE_CHECK.expected) {
    failures.push(`${PHRASE_CHECK.query} returned ${phrase}, expected ${PHRASE_CHECK.expected}`);
  }

  const tables = tableNames(db);
  for (const table of DROP_TABLES) {
    if (tables.has(table)) failures.push(`${table} should have been dropped`);
  }
  for (const table of EMPTY_TABLES) {
    if (!tables.has(table)) {
      failures.push(`${table} must exist (empty) for ensureBookSearchIndex()`);
      continue;
    }
    const rows = count(db, `SELECT count(*) AS n FROM ${table}`);
    if (rows !== 0) failures.push(`${table} should be empty, has ${rows} rows`);
  }

  const info = db
    .query<{ abbreviation: string | null; content_sha256: string | null }, []>(
      'SELECT abbreviation, content_sha256 FROM module_info LIMIT 1',
    )
    .get();
  if (!info?.abbreviation) failures.push('module_info is missing');

  db.close();

  process.stdout.write(`output ${path} (${mb(path)} MB)\n`);
  process.stdout.write(`  verses            ${verses}\n`);
  process.stdout.write(`  ${PHRASE_CHECK.query.padEnd(18)}${phrase} hits\n`);
  process.stdout.write(`  abbreviation      ${info?.abbreviation}\n`);
  process.stdout.write(`  content_sha256    ${String(info?.content_sha256).slice(0, 16)}…\n`);

  if (failures.length > 0) {
    process.stderr.write(`\n${failures.length} check(s) failed:\n`);
    for (const f of failures) process.stderr.write(`  - ${f}\n`);
    return 1;
  }

  process.stdout.write('\nall checks passed\n');
  return 0;
}

try {
  process.exit(main());
} catch (error) {
  process.stderr.write(`build-kjv: ${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
}
