#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * scripts/init/index.js -- turn a directory of module `.db` files into a working install.
 *
 * ## What this exists to solve
 *
 * Module databases are content, not code, so `data/` is gitignored in its
 * entirety and a fresh clone has none.  But dropping `.db` files into
 * `data/modules/` is not by itself enough: every consumer -- both apps, every
 * server suite, the Playwright run -- reaches modules through the registry in
 * `main.db`, which records what exists and where its file is.  Without that
 * registry the files on disk are invisible, and the symptom is never "you have
 * no registry".  It is an empty module picker, ten core suites skipping
 * themselves, or five Playwright projects failing on selector timeouts.  This
 * script builds the registry, and says plainly when it cannot.
 *
 * ## What it produces
 *
 *   <data-dir>/main.db      the registry: schema, the canonical verse space,
 *                           and one `module_metadata` row per module found
 *   apps/web/data/site-config.json   (web target only, and only when absent)
 *
 * Everything is derived from files already in the repository -- the schema
 * under `packages/core/sql/schemas/`, the canonical versification under
 * `apps/desktop/scripts/data/` -- so no seed `main.db` is needed and the whole
 * thing runs offline.  `--catalog` additionally fetches a module catalog and
 * downloads modules; see `catalog.js` beside this file.
 *
 * ## Why better-sqlite3-web
 *
 * The desktop app's `better-sqlite3` is compiled against Electron's ABI and
 * cannot be loaded by system Node.  `better-sqlite3-web` is the same library
 * under an npm alias, built for the Node that runs this script -- which is why
 * `apps/web` depends on it under that name.  For the same reason this script
 * cannot import `InstallationService` or `ModuleCatalogService`, which live in
 * `apps/desktop/electron` and bind the Electron build.
 *
 * ## Usage
 *
 *   node scripts/init/index.js [options]
 *
 *   --target=web|desktop   Which install to initialise (default: web).
 *   --data-dir=PATH        Where main.db is written.  Overrides --target.
 *   --modules-dir=PATH     Parent of `modules/`.  Overrides --target.
 *   --force                Delete and rebuild main.db rather than updating it.
 *   --prune                Remove registry rows whose file is missing.
 *   --no-config            Skip writing site-config.json (web target).
 *   --catalog[=URL]        Fetch a catalog and choose modules to download.
 *   --select=KJV,ASV       With --catalog, take these instead of prompting.
 *   --yes                  Never prompt; accept defaults.  For CI.
 *   --quiet                Only warnings and errors.
 *   --help
 *
 * Exit codes: 0 success, 1 nothing usable was produced, 2 usage error.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3-web');

const REPO_ROOT = path.resolve(__dirname, '../..');
const SCHEMA_FILE = path.join(REPO_ROOT, 'packages/core/sql/schemas/initial/MainDatabase.sql');
const VERSIFICATION_FILE = path.join(REPO_ROOT, 'apps/desktop/scripts/data/kjv-versification.json');
const SITE_CONFIG_EXAMPLE = path.join(REPO_ROOT, 'apps/web/config/site-config.example.json');

/**
 * Where each target keeps its registry and its module files.
 *
 * The two are separable on purpose.  The web server resolves each module's
 * `database_path` against `BIBLE_MODULES_DIR` while reading its registry from
 * `BIBLE_DATA_DIR`, so the shared store at the repo root can serve several
 * installs.  The desktop is the exception: in development `getUserDataPath()`
 * resolves to `apps/desktop/data`, and it looks for `modules/` directly beneath
 * that -- it has no equivalent of `BIBLE_MODULES_DIR`.  So a desktop install
 * either keeps its own copy of the module files or has that directory pointed
 * at the shared one; `--modules-dir` reports the mismatch rather than guessing.
 */
const TARGETS = {
  web: {
    // One registry, in the shared store.  The web server, the core test
    // helpers and the server test helpers all resolve `main.db` here, and the
    // module files sit beside it -- which is what several suites require, since
    // they build a DatabaseManager with the data directory as the modules root
    // as well.  `apps/web/data` is not a second registry: it holds only what a
    // running instance writes for itself (logs, plugins), so two installs
    // sharing this store cannot overwrite each other's.
    dataDirs: [path.join(REPO_ROOT, 'data')],
    modulesDir: path.join(REPO_ROOT, 'data'),
    writesSiteConfig: true,
  },
  desktop: {
    dataDirs: [path.join(REPO_ROOT, 'apps/desktop/data')],
    modulesDir: path.join(REPO_ROOT, 'apps/desktop/data'),
    writesSiteConfig: false,
  },
};

/**
 * What the test suites and the apps actually need, keyed by module abbreviation.
 *
 * This is the difference between "you have 3 modules" and "the Playwright suite
 * will refuse to start because ASV and AmTract are missing".  A newcomer cannot
 * be expected to know that `api.test.ts` pins Clarke by name, so the script says
 * it.  Kept in step with the table in the repository README.
 */
const EXPECTED_MODULES = [
  { abbr: 'KJV', file: 'bible_kjv.db', need: 'required', why: 'core BibleRepository and search; the web bible, search, interlinear and Strong\'s routes' },
  { abbr: 'Barnes', file: 'commentary_barnes.db', need: 'required', why: 'core CommentaryRepository and study overview; the web commentary routes' },
  { abbr: 'Clarke', file: 'commentary_clarke.db', need: 'required', why: 'the web api.test.ts, which pins Clarke\'s Exodus 31 and Psalm 47 entries by name' },
  { abbr: 'Easton', file: 'dictionary_easton.db', need: 'required', why: 'core DictionaryRepository; the web dictionary routes' },
  { abbr: 'StrongsGreek', file: 'dictionary_strongsgreek.db', need: 'required', why: 'the web Strong\'s routes' },
  { abbr: 'StrongsHebrew', file: 'dictionary_strongshebrew.db', need: 'required', why: 'the web Strong\'s routes' },
  { abbr: 'NaveTopics', file: 'topical_nave.db', need: 'required', why: 'core TopicalIndexRepository and topic aggregation; the web topical routes' },
  { abbr: 'TSKxref', file: 'xref_tsk.db', need: 'required', why: 'core CrossReferenceRepository and cross-reference aggregation; the web routes' },
  { abbr: 'Concord', file: 'book_concord.db', need: 'required', why: 'core BookRepository' },
  { abbr: 'ASV', file: 'bible_asv.db', need: 'e2e', why: 'the Playwright fixture names KJV, ASV, Barnes and AmTract' },
  { abbr: 'AmTract', file: 'dictionary_amtract.db', need: 'e2e', why: 'the Playwright fixture names KJV, ASV, Barnes and AmTract' },
  { abbr: 'SYNTHESIS', file: 'commentary_synthesis.db', need: 'e2e', why: 'the commentary pane opens on the digest tab, so without it its default view is empty' },
  { abbr: 'Scofield', file: 'commentary_scofield.db', need: 'desktop-e2e', why: "reference-links.spec.ts opens Scofield on John 3:16; without it the module picker never closes and all nine of its tests fail" },
  { abbr: 'MHC', file: 'commentary_mhc.db', need: 'desktop-e2e', why: "ai-disclaimer.spec.ts asserts that a human-authored commentary carries no AI notice, and names Matthew Henry" },
  { abbr: 'TorreyTopics', file: 'topical_torrey.db', need: 'optional', why: 'a second topical source, so the topical routes meet more than one' },
];

/** `module_metadata.module_type` values, mirroring core's MODULE_TYPES. */
const MODULE_TYPES = new Set([
  'bible', 'commentary', 'dictionary', 'book', 'devotional',
  'lexicon', 'topical_index', 'cross_reference', 'tag_graph',
]);

/** Which `site-config.json` section a module type is listed under, if any. */
const SITE_CONFIG_SECTION = {
  bible: 'bibles',
  commentary: 'commentaries',
  dictionary: 'dictionaries',
  lexicon: 'dictionaries',
};

// ============================================================================
// Schema loading
// ============================================================================

/**
 * A whole-line `-- @include <path>` directive.
 *
 * Ported from `packages/core/src/Data/Schema/loadSchemaSql.ts` rather than
 * imported: that module ships from core's `dist/`, and requiring a build step
 * before a machine can be initialised is exactly the friction this script is
 * meant to remove.  The two must stay in step -- if the directive syntax ever
 * changes, it changes in both places.
 */
const INCLUDE_DIRECTIVE = /^[ \t]*--[ \t]*@include[ \t]+(\S+)[ \t]*$/gmu;
const MAX_INCLUDE_DEPTH = 8;

function loadSchemaSql(schemaPath, depth = 0, stack = []) {
  const absolute = path.resolve(schemaPath);
  if (depth > MAX_INCLUDE_DEPTH) {
    throw new Error(`include depth exceeded at ${absolute} (chain: ${[...stack, absolute].join(' -> ')})`);
  }
  const source = fs.readFileSync(absolute, 'utf8');
  const directory = path.dirname(absolute);
  INCLUDE_DIRECTIVE.lastIndex = 0;
  return source.replace(INCLUDE_DIRECTIVE, (_m, target) =>
    loadSchemaSql(path.resolve(directory, target), depth + 1, [...stack, absolute]).replace(/\n+$/u, '')
  );
}

// ============================================================================
// The canonical verse space
// ============================================================================

/**
 * Fill `bible_book`, `chapter_info` and `bible_verse_ref` from the checked-in
 * versification.
 *
 * These three tables are the canonical reference space: 66 books, 1,189
 * chapters and 31,102 verses under standard English (KJV) numbering.  Nothing
 * at runtime ever writes them, and no module supplies them -- the desktop app
 * copies them from a bundled `main.db` it does not have in this checkout.
 * Generating them from `kjv-versification.json` is what lets a clone build a
 * registry with no seed database at all.
 *
 * `absolute_id` is the gapless 1-based ordinal (Genesis 1:1 = 1, Revelation
 * 22:21 = 31102).  `verse_id` is NOT gapless, so "next verse" and "verses
 * between X and Y" are arithmetic on the absolute id, which is why
 * `chapter_info` stores each chapter's first and last.
 */
function buildReferenceSpace(db, log) {
  const existing = db.prepare('SELECT COUNT(*) AS n FROM bible_verse_ref').get().n;
  if (existing > 0) {
    log.debug(`Reference space already present (${existing} verses); leaving it alone.`);
    return;
  }

  const versification = JSON.parse(fs.readFileSync(VERSIFICATION_FILE, 'utf8'));

  const insertBook = db.prepare(
    `INSERT INTO bible_book (book_number, book_name, book_abbreviation, testament, book_group, chapter_count, verse_count)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const insertChapter = db.prepare(
    `INSERT INTO chapter_info (book_id, chapter, verse_count, first_absolute_id, last_absolute_id)
     VALUES (?, ?, ?, ?, ?)`
  );
  const insertVerse = db.prepare(
    `INSERT INTO bible_verse_ref (verse_id, absolute_id, book_id, chapter, verse, is_book_start, is_division_start)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  // Psalms chapters each count as a division start: every psalm is a standalone
  // work, and readers page and title by division.
  const PSALMS = 19;

  const build = db.transaction(() => {
    let absolute = 0;
    for (const book of versification.books) {
      const verseCount = book.verse_counts.reduce((sum, n) => sum + n, 0);
      const info = insertBook.run(
        book.book_number, book.name, book.abbreviation,
        book.testament, book.book_group, book.verse_counts.length, verseCount
      );
      const bookId = info.lastInsertRowid;

      book.verse_counts.forEach((versesInChapter, index) => {
        const chapter = index + 1;
        const first = absolute + 1;
        for (let verse = 1; verse <= versesInChapter; verse++) {
          absolute += 1;
          const verseId = book.book_number * 1000000 + chapter * 1000 + verse;
          const isBookStart = chapter === 1 && verse === 1 ? 1 : 0;
          const isDivisionStart =
            isBookStart || (book.book_number === PSALMS && verse === 1) ? 1 : 0;
          insertVerse.run(verseId, absolute, bookId, chapter, verse, isBookStart, isDivisionStart);
        }
        insertChapter.run(bookId, chapter, versesInChapter, first, absolute);
      });
    }
    return absolute;
  });

  const total = build();
  const expected = versification.totals.verses;
  if (total !== expected) {
    throw new Error(`Reference space built ${total} verses but the versification declares ${expected}`);
  }
  log.info(`Built the canonical verse space: ${versification.totals.books} books, ` +
    `${versification.totals.chapters} chapters, ${total} verses.`);
}

// ============================================================================
// Module discovery
// ============================================================================

/**
 * Read a module's self-description.
 *
 * Every module carries a singleton `module_info` row declaring its identity --
 * uuid, type, abbreviation, name, language, content version.  That is the
 * module format's contract, so registering a module is transcription rather
 * than guesswork: nothing here infers a type from a filename.
 *
 * Opened read-only.  This script never writes to a module file.
 */
function readModuleInfo(filePath) {
  let db;
  try {
    db = new Database(filePath, { readonly: true, fileMustExist: true });
  } catch (cause) {
    return { ok: false, error: `cannot open: ${cause.message}` };
  }

  try {
    const hasTable = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'module_info'")
      .get();
    if (!hasTable) {
      return { ok: false, error: 'no module_info table -- not a module database, or an old format' };
    }

    const info = db.prepare('SELECT * FROM module_info WHERE info_id = 1').get();
    if (!info) return { ok: false, error: 'module_info has no info_id = 1 row' };

    const missing = ['module_uuid', 'module_type', 'abbreviation', 'full_name']
      .filter((field) => !info[field]);
    if (missing.length > 0) {
      return { ok: false, error: `module_info is missing ${missing.join(', ')}` };
    }
    if (!MODULE_TYPES.has(info.module_type)) {
      return { ok: false, error: `unrecognised module_type "${info.module_type}"` };
    }

    return { ok: true, info };
  } catch (cause) {
    return { ok: false, error: `unreadable: ${cause.message}` };
  } finally {
    if (db) db.close();
  }
}

/** Every `.db` directly under `<modulesDir>/modules`, with its module_info. */
function scanModules(modulesRoot, log) {
  const dir = path.join(modulesRoot, 'modules');
  if (!fs.existsSync(dir)) {
    return { dir, missing: true, found: [], rejected: [] };
  }

  const files = fs.readdirSync(dir)
    .filter((name) => name.endsWith('.db'))
    .sort();

  const found = [];
  const rejected = [];
  for (const name of files) {
    const filePath = path.join(dir, name);
    const result = readModuleInfo(filePath);
    if (result.ok) {
      found.push({ file: name, path: filePath, info: result.info, size: fs.statSync(filePath).size });
      log.debug(`  ${name}: ${result.info.abbreviation} (${result.info.module_type})`);
    } else {
      rejected.push({ file: name, error: result.error });
    }
  }
  return { dir, missing: false, found, rejected };
}

// ============================================================================
// The registry
// ============================================================================

/**
 * Write one module's registry row.
 *
 * Identity is `module_uuid` where there is one: an abbreviation is a display
 * string that two publishers can collide on and that changes when an edition is
 * renamed, whereas the uuid is fixed for the life of the module.  Keying on it
 * means re-running after replacing a module file updates the row in place
 * rather than leaving a duplicate behind under the old name.
 *
 * But `module_uuid` was added to the registry later than the rows it now
 * identifies, and an install predating it has the column NULL on every row.
 * Matching on the uuid alone would find nothing there and insert a second row
 * for every module already registered -- so an older row is matched on its
 * `database_path` instead, which is the file it points at, and the uuid is
 * backfilled from the module while we are there.  A second run then matches on
 * the uuid like any other.
 */
function upsertModule(db, module, log) {
  const { info, file, size } = module;
  const databasePath = path.posix.join('modules', file);
  const now = new Date().toISOString();

  const existing =
    db.prepare('SELECT module_id, abbreviation, module_uuid FROM module_metadata WHERE module_uuid = ?')
      .get(info.module_uuid)
    ?? db.prepare(
      `SELECT module_id, abbreviation, module_uuid FROM module_metadata
        WHERE database_path = ? AND (module_uuid IS NULL OR module_uuid = '')`
    ).get(databasePath);

  if (existing) {
    db.prepare(
      `UPDATE module_metadata
          SET module_type = ?, module_name = ?, abbreviation = ?, version = ?,
              language_code = ?, database_path = ?, size_bytes = ?, last_updated = ?,
              module_uuid = ?
        WHERE module_id = ?`
    ).run(
      info.module_type, info.full_name, info.abbreviation, info.content_version ?? null,
      info.language_code ?? 'en', databasePath, size, now, info.module_uuid, existing.module_id
    );
    if (existing.abbreviation !== info.abbreviation) {
      log.info(`  ${existing.abbreviation} -> ${info.abbreviation} (renamed; matched on uuid)`);
    }
    if (!existing.module_uuid) return 'backfilled';
    return 'updated';
  }

  db.prepare(
    `INSERT INTO module_metadata
       (module_type, module_name, abbreviation, version, language_code,
        installed_date, last_updated, database_path, size_bytes, is_indexed,
        features, module_uuid)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '[]', ?)`
  ).run(
    info.module_type, info.full_name, info.abbreviation, info.content_version ?? null,
    info.language_code ?? 'en', now, now, databasePath, size, info.module_uuid
  );
  return 'inserted';
}

/**
 * Registry rows whose file is not on disk.
 *
 * This is the failure that looks least like itself.  A row pointing at an
 * absent file leaves the module listed in every picker and every API response
 * until something tries to read it, at which point the route 404s and the
 * fault reads as a bug in the route.  Worth reporting loudly even when we are
 * not pruning.
 */
function findOrphanedRows(db, modulesRoot) {
  return db
    .prepare('SELECT module_id, abbreviation, database_path FROM module_metadata')
    .all()
    .filter((row) => !row.database_path || !fs.existsSync(path.join(modulesRoot, row.database_path)));
}

// ============================================================================
// site-config.json
// ============================================================================

/**
 * Write a starting `site-config.json` listing the modules that were registered.
 *
 * Module visibility is fail-safe: with no config the server shows nothing at
 * all, which is correct for copyright but indistinguishable from a broken
 * install.  Generating one from what is actually present is the difference
 * between an app that opens onto a Bible and an app that opens onto an empty
 * picker.
 *
 * Only ever written when absent -- this is somebody's configuration, and
 * overwriting their choices to "help" is not a trade this script gets to make.
 */
function writeSiteConfig(configPath, modules, log) {
  if (fs.existsSync(configPath)) {
    log.debug(`site-config.json already exists at ${configPath}; leaving it alone.`);
    return false;
  }

  const config = JSON.parse(fs.readFileSync(SITE_CONFIG_EXAMPLE, 'utf8'));
  const sections = { bibles: [], commentaries: [], dictionaries: [] };

  for (const key of Object.keys(sections)) {
    config.modules[key] = { modules: {}, sections: [] };
  }

  let order = 0;
  for (const module of modules) {
    const section = SITE_CONFIG_SECTION[module.info.module_type];
    if (!section) continue;
    order += 1;
    config.modules[section].modules[module.info.abbreviation] = { active: true, sortOrder: order };
    sections[section].push(module.info.abbreviation);
  }

  const TITLES = { bibles: 'Translations', commentaries: 'Commentaries', dictionaries: 'Dictionaries' };
  for (const [key, abbrs] of Object.entries(sections)) {
    if (abbrs.length > 0) {
      config.modules[key].sections = [{ title: TITLES[key], modules: abbrs }];
    }
  }

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  log.info(`Wrote ${configPath} with ${order} module(s) visible.`);
  return true;
}

// ============================================================================
// Reporting
// ============================================================================

/**
 * Say what is present, what is missing, and what that costs.
 *
 * The point of naming the consequence is that no newcomer can be expected to
 * connect "no ASV" to "the Playwright run stops before the first test".  A
 * count of modules does not tell them; a list of what will not work does.
 */
function reportCoverage(installed, log) {
  const have = new Set(installed.map((m) => m.info.abbreviation.toLowerCase()));
  const missing = EXPECTED_MODULES.filter((m) => !have.has(m.abbr.toLowerCase()));

  const required = missing.filter((m) => m.need === 'required');
  const e2e = missing.filter((m) => m.need === 'e2e');
  const desktopE2e = missing.filter((m) => m.need === 'desktop-e2e');
  const optional = missing.filter((m) => m.need === 'optional');

  if (missing.length === 0) {
    log.info('Every module the test suites name is installed.');
    return;
  }

  if (required.length > 0) {
    log.warn('');
    log.warn(`${required.length} module(s) the test suites depend on are NOT installed:`);
    for (const m of required) log.warn(`  ${m.abbr.padEnd(14)} (${m.file}) -- ${m.why}`);
    log.warn('  Suites that use these will fail or skip themselves.');
  }

  if (e2e.length > 0) {
    log.warn('');
    log.warn(`${e2e.length} module(s) the Playwright suite needs are NOT installed:`);
    for (const m of e2e) log.warn(`  ${m.abbr.padEnd(14)} (${m.file}) -- ${m.why}`);
    log.warn('  `npm run test:e2e -w @bible/web` will stop before the first test.');
  }

  if (desktopE2e.length > 0) {
    log.warn('');
    log.warn(`${desktopE2e.length} module(s) the desktop Playwright suite names are NOT installed:`);
    for (const m of desktopE2e) log.warn(`  ${m.abbr.padEnd(14)} (${m.file}) -- ${m.why}`);
    log.warn('  Those specs fail; the rest of `npm run test:e2e -w @bible/desktop` still runs.');
  }

  if (optional.length > 0) {
    log.info('');
    log.info('Optional, absent, nothing fails without them:');
    for (const m of optional) log.info(`  ${m.abbr.padEnd(14)} (${m.file}) -- ${m.why}`);
  }
}

// ============================================================================
// CLI
// ============================================================================

function parseArgs(argv) {
  const options = {
    target: 'web', dataDir: null, modulesDir: null,
    force: false, prune: false, config: true,
    catalog: null, select: null, yes: false, quiet: false, help: false,
  };

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--force') options.force = true;
    else if (arg === '--prune') options.prune = true;
    else if (arg === '--no-config') options.config = false;
    else if (arg === '--yes' || arg === '-y') options.yes = true;
    else if (arg === '--quiet') options.quiet = true;
    else if (arg === '--catalog') options.catalog = true;
    else if (arg.startsWith('--catalog=')) options.catalog = arg.slice('--catalog='.length);
    else if (arg.startsWith('--select=')) options.select = arg.slice('--select='.length).split(',').map((s) => s.trim()).filter(Boolean);
    else if (arg.startsWith('--target=')) options.target = arg.slice('--target='.length);
    else if (arg.startsWith('--data-dir=')) options.dataDir = path.resolve(arg.slice('--data-dir='.length));
    else if (arg.startsWith('--modules-dir=')) options.modulesDir = path.resolve(arg.slice('--modules-dir='.length));
    else return { error: `unknown option: ${arg}` };
  }

  if (!TARGETS[options.target]) {
    return { error: `unknown target "${options.target}" (expected web or desktop)` };
  }
  return options;
}

function makeLogger(quiet) {
  return {
    info: (msg) => { if (!quiet) console.log(msg); },
    debug: (msg) => { if (!quiet && process.env.INIT_VERBOSE) console.log(msg); },
    warn: (msg) => console.warn(msg),
    error: (msg) => console.error(msg),
  };
}

/**
 * The message a newcomer with no module files sees.
 *
 * Deliberately the longest thing this script prints.  It is the single most
 * likely first-run outcome, and every downstream symptom of it is unrecognisable
 * as its cause, so the one place to explain the whole situation is here.
 */
function reportNoModules(modulesDir, log) {
  log.error('');
  log.error('No module databases found.');
  log.error('');
  log.error(`  Looked in: ${modulesDir}`);
  log.error('');
  log.error('Module databases are content, not code: they are not in the repository and');
  log.error('a fresh clone has none.  Nothing that reads scripture can work until they');
  log.error('are supplied -- both apps, the web server test suites and the Playwright');
  log.error('run all reach modules through the registry this script builds.');
  log.error('');
  log.error('Two ways forward:');
  log.error('');
  log.error('  1. If you already have module files, put them there and re-run:');
  log.error(`       mkdir -p "${modulesDir}"`);
  log.error(`       cp /path/to/modules/*.db "${modulesDir}"`);
  log.error('       npm run init');
  log.error('');
  log.error('  2. Download them from a catalog:');
  log.error('       npm run init -- --catalog');
  log.error('');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.error) {
    console.error(`init: ${options.error}`);
    console.error('Try --help.');
    process.exit(2);
  }
  if (options.help) {
    console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^\/\*+|^ \* ?|^#!.*|\/\* eslint.*/gm, ''));
    process.exit(0);
  }

  const log = makeLogger(options.quiet);
  const target = TARGETS[options.target];
  const dataDirs = options.dataDir ? [options.dataDir] : target.dataDirs;
  const modulesDir = options.modulesDir ?? target.modulesDir;

  log.info(`Target:   ${options.target}`);
  for (const dir of dataDirs) log.info(`Registry: ${path.join(dir, 'main.db')}`);
  log.info(`Modules:  ${path.join(modulesDir, 'modules')}`);
  log.info('');

  // The desktop reads `modules/` from directly beneath its own data directory,
  // so a split layout it cannot honour is worth saying out loud rather than
  // producing a registry whose every path fails to resolve.
  if (options.target === 'desktop' && modulesDir !== dataDirs[0]) {
    log.warn('Note: the desktop app resolves modules relative to its own data directory.');
    log.warn(`      Registry rows will point into ${modulesDir}, which the app will not follow.`);
    log.warn('      Either copy the module files under the desktop data directory, or make');
    log.warn('      that path a directory junction/symlink to the shared store.');
    log.warn('');
  }

  if (options.catalog) {
    const { runCatalogInstall } = require('./catalog');
    const outcome = await runCatalogInstall({
      source: typeof options.catalog === 'string' ? options.catalog : null,
      modulesDir: path.join(modulesDir, 'modules'),
      select: options.select,
      assumeYes: options.yes,
      log,
    });
    if (outcome === 'aborted') process.exit(1);
  }

  const scan = scanModules(modulesDir, log);
  if (scan.missing || scan.found.length === 0) {
    reportNoModules(path.join(modulesDir, 'modules'), log);
    if (scan.rejected.length > 0) {
      log.error(`${scan.rejected.length} file(s) in that directory are not usable modules:`);
      for (const r of scan.rejected) log.error(`  ${r.file}: ${r.error}`);
      log.error('');
    }
    process.exit(1);
  }

  log.info(`Found ${scan.found.length} module(s).`);
  if (scan.rejected.length > 0) {
    log.warn(`Skipped ${scan.rejected.length} file(s) that are not usable modules:`);
    for (const r of scan.rejected) log.warn(`  ${r.file}: ${r.error}`);
    log.warn('  `npm run validate:module -- --all` explains a module format failure in full.');
  }

  for (const dataDir of dataDirs) {
    writeRegistry({ dataDir, modulesDir, scan, options, target, log });
  }

  log.info('');
  reportCoverage(scan.found, log);
  log.info('');
  log.info('Done.');
}

/**
 * Build or refresh one registry.
 *
 * Split out because the web target writes two of them (see TARGETS): the same
 * scan, transcribed twice, so the shared store and the server's own data
 * directory cannot disagree about what is installed.
 */
function writeRegistry({ dataDir, modulesDir, scan, options, target, log }) {
  const mainDbPath = path.join(dataDir, 'main.db');
  log.info(`--- ${mainDbPath}`);

  if (options.force && fs.existsSync(mainDbPath)) {
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${mainDbPath}${suffix}`, { force: true });
    log.info('Removed the existing registry (--force).');
  }

  fs.mkdirSync(dataDir, { recursive: true });
  const isNew = !fs.existsSync(mainDbPath);
  const db = new Database(mainDbPath);

  try {
    db.pragma('foreign_keys = ON');
    if (isNew) {
      db.exec(loadSchemaSql(SCHEMA_FILE));
      log.info('Created the registry schema.');
    }
    buildReferenceSpace(db, log);

    const counts = { inserted: 0, updated: 0, backfilled: 0 };
    const register = db.transaction(() => {
      for (const module of scan.found) counts[upsertModule(db, module, log)] += 1;
    });
    register();
    log.info(`Registered ${counts.inserted} new module(s); refreshed ${counts.updated}.`);
    if (counts.backfilled > 0) {
      log.info(`Backfilled module_uuid on ${counts.backfilled} row(s) that predated the column.`);
    }

    const orphans = findOrphanedRows(db, modulesDir);
    if (orphans.length > 0) {
      if (options.prune) {
        const remove = db.prepare('DELETE FROM module_metadata WHERE module_id = ?');
        db.transaction(() => orphans.forEach((row) => remove.run(row.module_id)))();
        log.info(`Pruned ${orphans.length} registry row(s) whose file was missing.`);
      } else {
        log.warn('');
        log.warn(`${orphans.length} registered module(s) have no file on disk:`);
        for (const row of orphans) log.warn(`  ${row.abbreviation} -> ${row.database_path}`);
        log.warn('  These stay listed in every picker and 404 when opened.  Re-run with --prune to remove them.');
      }
    }

    if (target.writesSiteConfig && options.config) {
      writeSiteConfig(path.join(dataDir, 'site-config.json'), scan.found, log);
    }
  } finally {
    db.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('');
    console.error(`init failed: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { loadSchemaSql, buildReferenceSpace, readModuleInfo, EXPECTED_MODULES };
