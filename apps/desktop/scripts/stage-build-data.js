#!/usr/bin/env node
/**
 * Stage a curated `build-data/` folder for the offline Bible Desktop installer.
 *
 * Produces apps/desktop/build-data with exactly what the packaged app should
 * ship at resources/data:
 *   - main.db                          (clean copy, module_metadata emptied; the
 *                                       boot-time detector re-registers only the
 *                                       bundled modules)
 *   - modules/bible_kjv.db             (KJV)
 *   - modules/commentary_synthesis.db  (AI-synthesized verse-by-verse commentary)
 *   - modules/commentary_mhc.db        (Matthew Henry's Complete Commentary)
 *   - modules/dictionary_strongsgreek.db   (Strong's Greek lexicon)
 *   - modules/dictionary_strongshebrew.db  (Strong's Hebrew lexicon)
 *   - modules/topical_nave.db          (Nave's Topical Bible)
 *   - modules/topical_torrey.db        (Torrey's New Topical Textbook)
 *   - modules/xref_tsk.db              (Treasury of Scripture Knowledge)
 *   - semantic_index.db                (optional; WAL checkpointed into one file;
 *                                       renamed from data/semantic_nomic-v1.5.db,
 *                                       the file the embedding pipeline produces)
 *   - search-pipeline.json             (optional)
 *   - models/Xenova/nomic-embed-text-v1/...  (optional offline embedding model)
 *
 * DB files are produced with `VACUUM INTO`, which reads the live DB plus any
 * uncheckpointed WAL and writes a fresh single-file copy - so no -wal/-shm files
 * get shipped into the read-only install location.
 *
 * Uses the async `sqlite3` driver (system Node.js), per the repo's driver split.
 */
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');

const REPO = path.resolve(__dirname, '..', '..', '..');
const DATA = path.join(REPO, 'apps', 'desktop', 'data');
const OUT = path.join(REPO, 'apps', 'desktop', 'build-data');
// The real on-disk cache directory transformers.js populates for this model is
// keyed by its HF repo id (`nomic-ai/nomic-embed-text-v1.5`), NOT the `Xenova/
// nomic-embed-text-v1` name the runtime asks for. Point SOURCE at that name and
// staging silently skips the model - see the loud warning below.
// The STAGED destination directory name is intentionally
// different (`models/Xenova/nomic-embed-text-v1`, see MODEL_DEST) because that
// is the model id the runtime `pipeline('feature-extraction', 'Xenova/nomic-
// embed-text-v1', ...)` call in electron/ipc/searchHandlers.ts asks
// transformers.js to resolve under `env.localModelPath`.
const MODEL_CACHE = path.join(
  REPO,
  'node_modules',
  '@huggingface',
  'transformers',
  '.cache',
  'nomic-ai',
  'nomic-embed-text-v1.5'
);

// DBs to ship: [sourceRelativeToData, destRelativeToOut]
// The boot-time detector (electron/utils/moduleDetector.ts) auto-registers any
// .db that lands in resources/data/modules, so this array *is* the default
// install's module set. Keep the two Strong's files distinct from the empty
// legacy stubs (dictionary_strongs_greek.db is empty; strongsgreek.db is real).
const DBS = [
  ['main.db', 'main.db'],
  // Bible
  ['modules/bible_kjv.db', 'modules/bible_kjv.db'],
  // Commentaries
  ['modules/commentary_synthesis.db', 'modules/commentary_synthesis.db'],
  ['modules/commentary_mhc.db', 'modules/commentary_mhc.db'],
  // Lexicons + standard Bible dictionary
  ['modules/dictionary_strongsgreek.db', 'modules/dictionary_strongsgreek.db'],
  ['modules/dictionary_strongshebrew.db', 'modules/dictionary_strongshebrew.db'],
  // Topical indexes - public domain, small (~10 MB / ~5.4 MB). Populates the
  // Study pane's Topics view; without them, topical lookups come back empty.
  ['modules/topical_nave.db', 'modules/topical_nave.db'],
  ['modules/topical_torrey.db', 'modules/topical_torrey.db'],
  // Cross-references - public domain. The largest single entry in this set
  // (~67.6 MB raw / ~17.9 MB compressed, ~11% of the installer), included
  // because the Study pane's cross-references view is otherwise empty.
  ['modules/xref_tsk.db', 'modules/xref_tsk.db'],
];

// Optional DBs: staged only if present. The semantic index powers offline
// semantic search; without it (and the embedding model below) the app falls
// back to FTS keyword search.
//
// SOURCE is `semantic_nomic-v1.5.db` - the file the embedding pipeline
// actually produces in apps/desktop/data/. DEST is renamed to the fixed
// runtime filename `semantic_index.db` (appPaths.ts SEMANTIC_INDEX_FILENAME,
// read by resolveSemanticIndexPath()) - staging renames to the canonical name,
// the runtime constant does not change to match the source. The two must never
// be equal to the same literal `semantic_index.db` on the source side; that
// file has never existed here, which is why this DB silently failed to stage.
//
// ISBE is optional rather than required because the file is not in the
// repository. Listing it as required would make `npm run
// package:{linux,win,mac}` fail outright on any checkout that lacked a
// private copy - staging is deliberately fail-closed on the required set, so
// the whole build would stop here. Keeping it optional preserves that
// fail-closed guarantee for the modules that really do ship, and the loud
// skip below keeps the intent to ship ISBE visible instead of silently
// dropping it.
// Each entry carries the consequence of its own absence: the warning below is
// printed per entry, so a generic "something was skipped" line would not tell
// a release builder what the resulting installer is actually missing.
const OPTIONAL_DBS = [
  [
    'semantic_nomic-v1.5.db',
    'semantic_index.db',
    'Offline semantic search will be UNAVAILABLE in this build. Rebuild the ' +
      'semantic index, or check that the source path here still matches the ' +
      'file that pipeline produces.',
  ],
  [
    'modules/dictionary_isbe.db',
    'modules/dictionary_isbe.db',
    'The ISBE Bible dictionary will NOT ship in this build. This file is not in ' +
      'the repository; supply it in data/modules/ to include it.',
  ],
];

// Plain files copied as-is (small config).
const FILES = [['search-pipeline.json', 'search-pipeline.json']];

// Embedding model files (offline). Paths relative to MODEL_CACHE, mirrored under
// build-data/models/Xenova/nomic-embed-text-v1/ so transformers' localModelPath
// resolves <localModelPath>/Xenova/nomic-embed-text-v1/...
const MODEL_FILES = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'onnx/model.onnx',
];
const MODEL_DEST = path.join(OUT, 'models', 'Xenova', 'nomic-embed-text-v1');

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function open(file, mode) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(file, mode, (err) => (err ? reject(err) : resolve(db)));
  });
}

function close(db) {
  return new Promise((resolve, reject) => db.close((err) => (err ? reject(err) : resolve())));
}

async function vacuumInto(srcAbs, destAbs) {
  fs.mkdirSync(path.dirname(destAbs), { recursive: true });
  for (const ext of ['', '-wal', '-shm']) {
    if (fs.existsSync(destAbs + ext)) fs.rmSync(destAbs + ext);
  }
  const db = await open(srcAbs, sqlite3.OPEN_READWRITE); // RW so WAL can checkpoint
  try {
    await run(db, 'PRAGMA wal_checkpoint(TRUNCATE)');
    await run(db, 'VACUUM INTO ?', [destAbs]);
  } finally {
    await close(db);
  }
}

function mb(p) {
  return (fs.statSync(p).size / (1024 * 1024)).toFixed(1) + ' MB';
}

(async () => {
  console.log('Staging curated build-data ->', OUT);

  // Fresh start
  if (fs.existsSync(OUT)) fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'modules'), { recursive: true });

  // 1) Required DBs via VACUUM INTO
  for (const [src, dest] of DBS) {
    const srcAbs = path.join(DATA, src);
    const destAbs = path.join(OUT, dest);
    if (!fs.existsSync(srcAbs)) throw new Error('Missing source DB: ' + srcAbs);
    process.stdout.write(`  VACUUM ${src} ... `);
    await vacuumInto(srcAbs, destAbs);
    console.log(mb(destAbs));
  }

  // 1b) Optional DBs - skip (with a LOUD warning) if absent so the module
  //     bundle still builds without the semantic-search artifacts. Loud on
  //     purpose: a silent skip here is exactly what let this drift for a long
  //     time - the source filename was wrong and nobody noticed because the
  //     build "succeeded" either way.
  for (const [src, dest, consequence] of OPTIONAL_DBS) {
    const srcAbs = path.join(DATA, src);
    if (!fs.existsSync(srcAbs)) {
      console.warn(`  [WARN] SKIPPING ${src} — not found: ${srcAbs}`);
      console.warn(`  [WARN] ${consequence}`);
      console.warn(`  [WARN] (optional entry declared in ${path.basename(__filename)})`);
      continue;
    }
    process.stdout.write(`  VACUUM ${src} -> ${dest} ... `);
    await vacuumInto(srcAbs, path.join(OUT, dest));
    console.log(mb(path.join(OUT, dest)));
  }

  // 2) Empty the module registry in the staged main.db so the boot detector
  //    registers exactly the bundled modules (no stale/broken entries).
  const mainAbs = path.join(OUT, 'main.db');
  const mdb = await open(mainAbs, sqlite3.OPEN_READWRITE);
  try {
    const before = await get(mdb, 'SELECT COUNT(*) AS n FROM module_metadata');
    await run(mdb, 'DELETE FROM module_metadata');
    await run(mdb, 'VACUUM');
    console.log(`  Cleared module_metadata (${before.n} rows -> 0)`);
  } finally {
    await close(mdb);
  }

  // 3) Plain config files
  for (const [src, dest] of FILES) {
    const srcAbs = path.join(DATA, src);
    if (fs.existsSync(srcAbs)) {
      fs.copyFileSync(srcAbs, path.join(OUT, dest));
      console.log(`  Copied ${src}`);
    } else {
      console.log(`  (skip, missing) ${src}`);
    }
  }

  // 4) Offline embedding model (optional). Without it, offline semantic search
  //    is unavailable; the app falls back to FTS keyword search. Populate the
  //    cache by running the embedding pipeline once (it downloads the model),
  //    then re-run staging to bundle it.
  if (!fs.existsSync(MODEL_CACHE)) {
    console.warn(`  [WARN] SKIPPING embedding model — cache not found: ${MODEL_CACHE}`);
    console.warn('  [WARN] Offline semantic search will be UNAVAILABLE in this build.');
    console.warn('  [WARN] Run the embedding pipeline once to populate the cache (it');
    console.warn('  [WARN] downloads the model), then re-run staging to bundle it.');
  } else {
    for (const rel of MODEL_FILES) {
      const srcAbs = path.join(MODEL_CACHE, rel);
      const destAbs = path.join(MODEL_DEST, rel);
      if (!fs.existsSync(srcAbs)) throw new Error('Missing model file: ' + srcAbs);
      fs.mkdirSync(path.dirname(destAbs), { recursive: true });
      fs.copyFileSync(srcAbs, destAbs);
      console.log(`  Model ${rel} ... ${mb(destAbs)}`);
    }
  }

  console.log('Done. Staged build-data is ready.');
})().catch((err) => {
  console.error('Staging failed:', err);
  process.exit(1);
});
