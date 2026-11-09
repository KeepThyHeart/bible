#!/usr/bin/env node
/**
 * Builds fixtures/bible-data: a small, committed subset of the real Bible data
 * set (main.db plus a handful of modules) that desktop e2e, web e2e and the
 * ui-driver run against when no data directory is given.
 *
 * Usage:
 *   pnpm run build:core                      # once; the digest comes from @bible/core
 *   node scripts/fixtures/build-bible-fixture.mjs [--source <dataDir>] [--out <dir>] [--check]
 *
 * --source  data dir holding main.db and modules/ (default: <repo>/data, then apps/desktop/data).
 *           It is opened READ-ONLY (VACUUM INTO of a snapshot); nothing there is written.
 * --out     output directory (default: fixtures/bible-data).
 * --check   build into a temp dir and compare manifest hashes with the committed ones.
 *
 * See fixtures/bible-data/README.md.
 */
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(join(repoRoot, 'apps', 'desktop', 'package.json'));
const Database = createRequire(join(repoRoot, 'package.json'))('better-sqlite3');

export const GENERATOR_VERSION = 1;
export const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
const FIXED_DATE = '2026-01-01T00:00:00Z';

/** Chapters kept, as [book number, chapter]. One constant: edit and regenerate to add more. */
export const FIXTURE_CHAPTERS = [
  [1, 1], [1, 3], [2, 1], [3, 1], [19, 23], [20, 19],
  [40, 10], [40, 15], [40, 18], [41, 2], [42, 15],
  [43, 1], [43, 2], [43, 3], [43, 4],
  [45, 1], [45, 8], [66, 1],
];

/** Modules kept. `whole` keeps every row (small public-domain dictionary). */
export const MODULES = [
  { file: 'bible_kjv.db', kind: 'bible' },
  { file: 'bible_asv.db', kind: 'bible' },
  { file: 'commentary_wesley.db', kind: 'commentary', ntOnly: false },
  { file: 'commentary_barnes.db', kind: 'commentary', ntOnly: true },
  { file: 'dictionary_amtract.db', kind: 'dictionary', whole: true },
];

const USER_TABLES = ['setting', 'saved_search', 'search_history', 'module_download_queue', 'module_update'];

function sha256File(p) {
  return createHash('sha256').update(readFileSync(p)).digest('hex');
}

function parseArgs(argv) {
  const o = { source: null, out: join(repoRoot, 'fixtures', 'bible-data'), check: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') o.check = true;
    else if (a === '--source') o.source = resolve(argv[++i]);
    else if (a === '--out') o.out = resolve(argv[++i]);
    else throw new Error(`Unknown argument: ${a}`);
  }
  return o;
}

function findSource(explicit) {
  const candidates = explicit ? [explicit] : [join(repoRoot, 'data'), join(repoRoot, 'apps', 'desktop', 'data')];
  for (const c of candidates) {
    if (existsSync(join(c, 'main.db')) && existsSync(join(c, 'modules'))) return c;
  }
  throw new Error(`No source data dir with main.db and modules/ in: ${candidates.join(', ')}`);
}

/** Minimal ISql over a better-sqlite3 handle (same shape validate-module.js uses). */
function sqlAdapter(db, path) {
  return {
    queryOne: (s, p) => (p !== undefined ? db.prepare(s).get(p) : db.prepare(s).get()),
    queryAll: (s, p) => (p !== undefined ? db.prepare(s).all(p) : db.prepare(s).all()),
    execute() { throw new Error('read-only'); },
    transaction: cb => cb(),
    close() {},
    isOpen: () => true,
    getDatabasePath: () => path,
  };
}

/** Snapshot `src` (read-only) to `dest` with VACUUM INTO, which ignores live WAL state issues. */
function snapshot(src, dest) {
  rmSync(dest, { force: true });
  const s = new Database(src, { readonly: true, fileMustExist: true });
  try { s.prepare('VACUUM INTO ?').run(dest); } finally { s.close(); }
}

function hasTable(db, name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

function finalize(db, path) {
  db.pragma('journal_mode = DELETE');
  db.exec('VACUUM');
  db.close();
  for (const s of ['-wal', '-shm', '-journal']) rmSync(path + s, { force: true });
}

function buildModule(spec, srcDir, outDir, core) {
  const dest = join(outDir, 'modules', spec.file);
  const tmp = dest + '.tmp';
  snapshot(join(srcDir, 'modules', spec.file), tmp);
  const db = new Database(tmp);
  const sourceSha = db.prepare('SELECT content_sha256 FROM module_info').pluck().get();
  const info = db.prepare('SELECT module_type, abbreviation, license_spdx FROM module_info').get();
  db.exec('CREATE TEMP TABLE fx_chapter(ck INTEGER PRIMARY KEY)');
  const ins = db.prepare('INSERT INTO fx_chapter VALUES (?)');
  for (const [b, c] of FIXTURE_CHAPTERS) ins.run(b * 1000 + c);
  const keep = `(verse_id / 1000) IN (SELECT ck FROM fx_chapter)`;

  if (!spec.whole) {
    if (spec.kind === 'bible') {
      db.exec(`DELETE FROM bible_verse WHERE NOT ${keep}`);
      db.exec(`DELETE FROM interlinear_word WHERE NOT ${keep}`);
      if (hasTable(db, 'verse_positions')) db.exec(`DELETE FROM verse_positions WHERE NOT ${keep}`);
      db.exec(`DELETE FROM verse_link WHERE NOT ((verse_id_start / 1000) IN (SELECT ck FROM fx_chapter))`);
    } else if (spec.kind === 'commentary') {
      // Entry overlaps a kept chapter when it starts before the chapter ends and ends after it starts.
      const overlap = `EXISTS (SELECT 1 FROM fx_chapter f WHERE verse_id_start <= f.ck*1000+999 AND verse_id_end >= f.ck*1000)`;
      db.exec(`DELETE FROM commentary_entry WHERE NOT ${overlap}`);
      db.exec(`DELETE FROM verse_link WHERE source_id NOT IN (SELECT entry_id FROM commentary_entry)`);
    }
  }

  // The source Bible modules carry an EMPTY fts5 book_search_index that the v0.2 conformance
  // check rejects (the app builds its own sidecar keyword index). Drop it when it holds nothing.
  if (hasTable(db, 'book_search_index')) {
    const rows = db.prepare('SELECT count(*) FROM book_search_index_content').pluck().get();
    if (rows === 0) db.exec('DROP TABLE book_search_index');
  }

  // Recompute the content digest so a stale index keyed on the full module's sha is never reused.
  const registry = core.createNodeCodecRegistry();
  const sql = sqlAdapter(db, tmp);
  const codec = core.resolveModuleCodec(sql, registry);
  const sha = core.computeContentSha256(sql, core.normalizeModuleType(info.module_type), codec);
  db.prepare('UPDATE module_info SET content_sha256 = ?').run(sha);
  db.exec('DROP TABLE fx_chapter');
  finalize(db, tmp);
  rmSync(dest, { force: true });
  renameSync(tmp, dest);
  return { file: `modules/${spec.file}`, abbreviation: info.abbreviation, license: info.license_spdx, sourceSha, contentSha: sha };
}

function buildMain(srcDir, outDir, built) {
  const dest = join(outDir, 'main.db');
  const tmp = dest + '.tmp';
  snapshot(join(srcDir, 'main.db'), tmp);
  const db = new Database(tmp);
  const abbrs = built.map(b => b.abbreviation);
  db.prepare(`DELETE FROM module_metadata WHERE abbreviation NOT IN (${abbrs.map(() => '?').join(',')})`).run(...abbrs);
  const upd = db.prepare(`UPDATE module_metadata SET size_bytes = ?, is_indexed = 0, last_indexed_date = NULL,
    installed_date = ?, last_updated = ?, last_used_date = NULL, usage_count = 0, update_available = 0, user_hidden = 0
    WHERE abbreviation = ?`);
  for (const b of built) upd.run(statSync(join(outDir, b.file)).size, FIXED_DATE, FIXED_DATE, b.abbreviation);
  for (const t of USER_TABLES) if (hasTable(db, t)) db.exec(`DELETE FROM ${t}`);
  finalize(db, tmp);
  rmSync(dest, { force: true });
  renameSync(tmp, dest);
}

/** Sample note: a TipTap document on John 3:16, fixed timestamps. Seeded into <userData>/BibleReader/. */
function sampleNote() {
  return {
    bn: 1,
    type: 'study',
    title: 'Sample note',
    tags: [],
    passages: [{ start: 43003016, end: 43003016, association: 'primary' }],
    created: FIXED_DATE,
    updated: FIXED_DATE,
    content: {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'For God so loved the world (fixture sample note).' }] },
      ],
    },
    metadata: {},
  };
}

function listFiles(dir, base = dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p, base));
    else out.push(p.slice(base.length + 1));
  }
  return out.sort();
}

function build(srcDir, outDir) {
  const core = require('@bible/core');
  if (typeof core.computeContentSha256 !== 'function') {
    throw new Error('@bible/core is not built (run: pnpm run build:core)');
  }
  rmSync(outDir + '/modules', { recursive: true, force: true });
  mkdirSync(join(outDir, 'modules'), { recursive: true });
  mkdirSync(join(outDir, 'notes'), { recursive: true });
  const built = MODULES.map(m => buildModule(m, srcDir, outDir, core));
  buildMain(srcDir, outDir, built);
  writeFileSync(join(outDir, 'notes', 'Sample note.bn'), JSON.stringify(sampleNote(), null, 2) + '\n');

  // Validate every module with the public conformance checker.
  for (const b of built) {
    const r = spawnSync(process.execPath, [
      join(repoRoot, 'apps', 'desktop', 'scripts', 'validate-module.js'), join(outDir, b.file),
      '--quiet', `--main-db=${join(outDir, 'main.db')}`,
    ], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`validate-module failed for ${b.file}:\n${r.stdout}${r.stderr}`);
  }

  const files = listFiles(outDir).filter(f => /^(main\.db|modules\/.*\.db|notes\/.*)$/.test(f));
  const total = files.reduce((n, f) => n + statSync(join(outDir, f)).size, 0);
  if (total >= MAX_TOTAL_BYTES) throw new Error(`Fixture is ${total} bytes; limit is ${MAX_TOTAL_BYTES}`);
  const manifest = {
    generatorVersion: GENERATOR_VERSION,
    chapters: FIXTURE_CHAPTERS.map(([b, c]) => `${b}:${c}`),
    modules: built.map(b => ({ abbreviation: b.abbreviation, file: b.file, license: b.license, sourceContentSha256: b.sourceSha, contentSha256: b.contentSha })),
    files: Object.fromEntries(files.map(f => [f, sha256File(join(outDir, f))])),
    totalBytes: total,
  };
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const srcDir = findSource(opts.source);
  if (opts.check) {
    const tmp = mkdtempSync(join(tmpdir(), 'bible-fixture-check-'));
    try {
      const fresh = build(srcDir, tmp);
      const committed = JSON.parse(readFileSync(join(opts.out, 'manifest.json'), 'utf8'));
      const same = JSON.stringify(fresh.files) === JSON.stringify(committed.files);
      console.log(same ? 'fixture is up to date' : 'fixture differs from a fresh build');
      process.exitCode = same ? 0 : 1;
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
    return;
  }
  const m = build(srcDir, opts.out);
  console.log(`Built ${opts.out} from ${srcDir}: ${m.totalBytes} bytes`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
