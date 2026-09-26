#!/usr/bin/env node

/**
 * Standalone self-test for validate-module.js (task 0027, "Module Format v2",
 * revision 2, subtask F11).
 *
 * Why standalone rather than a vitest spec: `apps/desktop/vitest.config.ts`'s
 * `test.include` only picks up `src/**`, `electron/**` and
 * `extension-runtime/**` - `scripts/**` is not in it (confirmed by reading
 * the config; `build-feature-pack.js`, the closest sibling script, has no
 * test file at all, so there was no existing convention to follow here
 * either). Rather than widen a shared test config for one script, this file
 * runs itself directly under plain Node:
 *
 *   node apps/desktop/scripts/validate-module.selftest.js
 *
 * It builds real v0.2 module fixtures on disk with `loadSchemaSql` (the same
 * schema files a real publisher would use), runs `validateModule()` against
 * them, and throws (non-zero exit) on the first failed assertion.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const {
  loadSchemaSql,
  createNodeCodecRegistry,
  resolveModuleCodec,
  computeContentSha256,
  DeflateCodec,
} = require('@bible/core');

const { validateModule, loadCanon } = require('./validate-module.js');

const PROJECT_ROOT = path.join(__dirname, '..', '..', '..');
const BIBLE_SCHEMA = path.join(PROJECT_ROOT, 'packages', 'core', 'sql', 'schemas', 'initial', 'BibleTranslation.sql');
const COMMENTARY_SCHEMA = path.join(PROJECT_ROOT, 'packages', 'core', 'sql', 'schemas', 'initial', 'Commentary.sql');

const REGISTRY = createNodeCodecRegistry();

// ============================================================================
// Test harness
// ============================================================================

let passCount = 0;
let failCount = 0;
const tmpFiles = [];

function assert(cond, message) {
  if (!cond) {
    throw new Error(message);
  }
  passCount++;
  console.log(`  \x1b[32mok\x1b[0m  ${message}`);
}

async function test(name, fn) {
  console.log(`\n\x1b[1m${name}\x1b[0m`);
  try {
    await fn();
  } catch (e) {
    failCount++;
    console.error(`  \x1b[31mFAIL\x1b[0m ${e.message}`);
    console.error(e.stack.split('\n').slice(1, 4).join('\n'));
  }
}

function tmpDbPath(name) {
  const p = path.join(os.tmpdir(), `validate-module-selftest-${process.pid}-${name}-${Date.now()}.db`);
  tmpFiles.push(p);
  return p;
}

function cleanup() {
  for (const p of tmpFiles) {
    try { fs.unlinkSync(p); } catch { /* already gone */ }
    for (const suffix of ['-wal', '-shm']) {
      try { fs.unlinkSync(p + suffix); } catch { /* not present */ }
    }
  }
}

/** A synchronous ISql-shaped adapter over a write-mode fixture connection, for computing a digest at build time. */
function sqlLike(db) {
  return {
    queryOne: (sql, params) => (params !== undefined ? db.prepare(sql).get(params) : db.prepare(sql).get()),
    queryAll: (sql, params) => (params !== undefined ? db.prepare(sql).all(params) : db.prepare(sql).all()),
  };
}

function errorCodes(result) {
  return result.errors.map(e => e.code);
}

// ============================================================================
// Fixture builders
// ============================================================================

/**
 * A conforming v0.2 Bible module: real schema, all required columns, a
 * correct `content_sha256`, `compression = 'none'`.
 */
function buildConformingBible() {
  const dbPath = tmpDbPath('bible-ok');
  const db = new Database(dbPath);
  db.exec(loadSchemaSql(BIBLE_SCHEMA));

  db.prepare(`
    INSERT INTO module_info (
      info_id, module_uuid, module_type, abbreviation, full_name,
      format, format_version, content_version, content_sha256, compression,
      language_code, versification, license_spdx, source_url
    ) VALUES (1, ?, 'bible', 'TST', 'Test Bible',
      'bible-module', '0.2', '1.0', NULL, 'none',
      'en', 'kjv-english', 'PD', 'https://example.test/tst')
  `).run(crypto.randomUUID());

  const insertVerse = db.prepare(
    'INSERT INTO bible_verse (verse_id, text, word_count) VALUES (?, ?, ?)'
  );
  // Genesis 1:1-3 verse_ids (bookNumber*1000000 + chapter*1000 + verse).
  insertVerse.run(1001001, 'In the beginning God created the heaven and the earth.', 10);
  insertVerse.run(1001002, 'And the earth was without form, and void.', 8);
  insertVerse.run(1001003, 'And God said, Let there be light: and there was light.', 11);

  const resolvedCodec = resolveModuleCodec(sqlLike(db), REGISTRY);
  const digest = computeContentSha256(sqlLike(db), 'bible', resolvedCodec);
  db.prepare('UPDATE module_info SET content_sha256 = ? WHERE info_id = 1').run(digest);

  db.close();
  return dbPath;
}

/**
 * A legacy/v1-shaped module built off the real v0.2 schema but with two
 * specific v1-era defects layered on: `format_version = '2.0'` (the legacy
 * pre-0.x string) and a leftover FTS5 table.
 */
function buildLegacyShapedBible() {
  const dbPath = tmpDbPath('bible-legacy');
  const db = new Database(dbPath);
  db.exec(loadSchemaSql(BIBLE_SCHEMA));

  db.prepare(`
    INSERT INTO module_info (
      info_id, module_uuid, module_type, abbreviation, full_name,
      format, format_version, content_version, content_sha256, compression,
      language_code, versification, license_spdx, source_url
    ) VALUES (1, ?, 'bible', 'OLD', 'Old-shaped Bible',
      'bible-module', '2.0', '1.0', NULL, 'none',
      'en', 'kjv-english', 'PD', 'https://example.test/old')
  `).run(crypto.randomUUID());

  db.prepare('INSERT INTO bible_verse (verse_id, text, word_count) VALUES (?, ?, ?)')
    .run(1001001, 'In the beginning God created the heaven and the earth.', 10);

  // A leftover v1-era FTS5 table - exactly what checkNoFts5Tables exists to catch.
  db.exec("CREATE VIRTUAL TABLE bible_verse_fts USING fts5(verse_id UNINDEXED, text)");

  db.close();
  return dbPath;
}

/**
 * A conforming, DEFLATE-compressed commentary module with a real
 * preset dictionary, genuinely valid/decodable content.
 */
function buildCompressedCommentary() {
  const dbPath = tmpDbPath('commentary-compressed');
  const db = new Database(dbPath);
  db.exec(loadSchemaSql(COMMENTARY_SCHEMA));

  db.prepare(`
    INSERT INTO module_info (
      info_id, module_uuid, module_type, abbreviation, full_name,
      format, format_version, content_version, content_sha256, compression,
      language_code, versification, license_spdx, source_url
    ) VALUES (1, ?, 'commentary', 'TCM', 'Test Commentary',
      'commentary-module', '0.2', '1.0', NULL, 'deflate',
      'en', 'kjv-english', 'PD', 'https://example.test/tcm')
  `).run(crypto.randomUUID());

  const dictionary = Buffer.from(
    'commentary entry verse chapter book beginning heaven earth said light darkness '.repeat(20),
    'utf8'
  );
  db.prepare(
    'INSERT INTO compression_dictionary (codec, dict_id, dict_blob) VALUES (?, ?, ?)'
  ).run('deflate', 1, dictionary);

  const codec = new DeflateCodec(dictionary);
  const rows = [
    { entryId: 1, verseId: 1001001, text: 'In the beginning, Moses records the origin of all things: God created the heavens and the earth out of nothing.' },
    { entryId: 2, verseId: 1001002, text: 'The earth, newly created, was as yet without form and void, a formless mass awaiting the ordering work of God.' },
    { entryId: 3, verseId: 1001003, text: 'God said, Let there be light - the first recorded utterance of the Creator, and light sprang into being at His word.' },
  ];
  const insertEntry = db.prepare(`
    INSERT INTO commentary_entry (entry_id, verse_id_start, verse_id_end, entry_level, content, word_count)
    VALUES (?, ?, ?, 'verse', ?, ?)
  `);
  for (const row of rows) {
    const encoded = codec.encode(row.text);
    insertEntry.run(row.entryId, row.verseId, row.verseId, encoded, row.text.split(/\s+/).length);
  }

  const resolvedCodec = resolveModuleCodec(sqlLike(db), REGISTRY);
  const digest = computeContentSha256(sqlLike(db), 'commentary', resolvedCodec);
  db.prepare('UPDATE module_info SET content_sha256 = ? WHERE info_id = 1').run(digest);

  db.close();
  return dbPath;
}

/**
 * Same shape as {@link buildCompressedCommentary}, except one row's stored
 * frame is genuinely corrupt (not a valid DEFLATE stream at all) - proving
 * checkDecodeRoundTrip still catches real corruption, not just that it
 * stops flagging healthy compressed content.
 */
function buildCorruptCompressedCommentary() {
  const dbPath = tmpDbPath('commentary-corrupt');
  const db = new Database(dbPath);
  db.exec(loadSchemaSql(COMMENTARY_SCHEMA));

  db.prepare(`
    INSERT INTO module_info (
      info_id, module_uuid, module_type, abbreviation, full_name,
      format, format_version, content_version, content_sha256, compression,
      language_code, versification, license_spdx, source_url
    ) VALUES (1, ?, 'commentary', 'TCX', 'Test Corrupt Commentary',
      'commentary-module', '0.2', '1.0', NULL, 'deflate',
      'en', 'kjv-english', 'PD', 'https://example.test/tcx')
  `).run(crypto.randomUUID());

  const dictionary = Buffer.from('commentary verse chapter book '.repeat(20), 'utf8');
  db.prepare(
    'INSERT INTO compression_dictionary (codec, dict_id, dict_blob) VALUES (?, ?, ?)'
  ).run('deflate', 1, dictionary);

  const codec = new DeflateCodec(dictionary);
  const insertEntry = db.prepare(`
    INSERT INTO commentary_entry (entry_id, verse_id_start, verse_id_end, entry_level, content, word_count)
    VALUES (?, ?, ?, 'verse', ?, ?)
  `);
  const goodText = 'A genuinely long and legitimate piece of commentary content that decodes cleanly.';
  insertEntry.run(1, 1001001, 1001001, codec.encode(goodText), goodText.split(/\s+/).length);
  // Not a valid raw-DEFLATE stream at all - inflateRawSync must throw on it.
  insertEntry.run(2, 1001002, 1001002, Buffer.from([0xff, 0x00, 0xff, 0x00, 0x13, 0x37]), 1);

  // content_sha256 left NULL on purpose: computing it would itself try to
  // decode the corrupt row and throw, which is checkContentSha256's own
  // concern, not this fixture's - see that test's assertions instead.
  db.close();
  return dbPath;
}

// ============================================================================
// Tests
// ============================================================================

async function main() {
  const canon = await loadCanon();

  await test('a conforming v0.2 Bible module passes with zero errors', async () => {
    const dbPath = buildConformingBible();

    // Direct evidence the two pre-existing bugs are fixed, read straight off
    // the real schema this fixture was built from.
    const raw = new Database(dbPath, { readonly: true });
    const infoColumns = raw.prepare("SELECT name FROM pragma_table_info('module_info')").all().map(r => r.name);
    const verseLinkIndexes = raw.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'verse_link'"
    ).all().map(r => r.name);
    raw.close();
    console.log(`  module_info columns: ${infoColumns.join(', ')}`);
    console.log(`  verse_link indexes: ${verseLinkIndexes.join(', ')}`);
    assert(!infoColumns.includes('canon'), "real schema's module_info carries no 'canon' column (bug #1's premise)");
    assert(!verseLinkIndexes.includes('idx_verse_link_start'), "real schema's verse_link carries no 'idx_verse_link_start' index (bug #2's premise)");

    const result = await validateModule(dbPath, { canon });
    console.log(`  errors: ${JSON.stringify(result.errors, null, 2)}`);
    assert(result.ok === true, `result.ok is true (got false; errors: ${JSON.stringify(errorCodes(result))})`);
    assert(result.errors.length === 0, `zero errors reported (got ${result.errors.length}: ${JSON.stringify(errorCodes(result))})`);
    assert(!errorCodes(result).includes('missing_info_columns'), "no missing_info_columns error (would have named 'canon' before the fix)");
    assert(!errorCodes(result).includes('missing_verse_link_index'), "no missing_verse_link_index error (would have named 'idx_verse_link_start' before the fix)");
  });

  await test('a legacy/v1-shaped module fails with the specific new error codes', async () => {
    const dbPath = buildLegacyShapedBible();
    const result = await validateModule(dbPath, { canon });
    const codes = errorCodes(result);
    console.log(`  codes: ${JSON.stringify(codes)}`);
    assert(result.ok === false, 'result.ok is false');
    assert(codes.includes('wrong_format_version'), "wrong_format_version fires for format_version = '2.0'");
    assert(codes.includes('unexpected_fts5_table'), 'unexpected_fts5_table fires for a leftover FTS5 table');
    const fts5Error = result.errors.find(e => e.code === 'unexpected_fts5_table');
    assert(fts5Error.message.includes('bible_verse_fts'), 'unexpected_fts5_table names the offending table');
  });

  await test('a compressed module with genuinely valid content is NOT flagged content_corrupt', async () => {
    const dbPath = buildCompressedCommentary();
    const result = await validateModule(dbPath, { canon });
    const codes = errorCodes(result);
    console.log(`  codes: ${JSON.stringify(codes)}`);
    console.log(`  errors: ${JSON.stringify(result.errors, null, 2)}`);
    assert(!codes.includes('content_corrupt'), 'no content_corrupt (the regression this subtask exists to fix)');
    assert(!codes.includes('decode_failed'), 'no decode_failed (every row decodes cleanly)');
    assert(!codes.includes('missing_codec'), "no missing_codec ('deflate' is registered)");
    assert(!codes.includes('missing_dictionary_row'), 'no missing_dictionary_row (a real dictionary row was written)');
    assert(!codes.includes('content_sha256_mismatch'), 'no content_sha256_mismatch (digest computed against the same codec/dictionary)');
    assert(result.ok === true, `result.ok is true (got false; errors: ${JSON.stringify(codes)})`);
  });

  await test('a compressed module with a genuinely corrupt frame IS caught', async () => {
    const dbPath = buildCorruptCompressedCommentary();
    const result = await validateModule(dbPath, { canon });
    const codes = errorCodes(result);
    console.log(`  codes: ${JSON.stringify(codes)}`);
    console.log(`  errors: ${JSON.stringify(result.errors, null, 2)}`);
    assert(result.ok === false, 'result.ok is false');
    assert(codes.includes('decode_failed'), 'decode_failed fires for the row whose frame is not valid DEFLATE');
    const decodeError = result.errors.find(e => e.code === 'decode_failed');
    assert(decodeError.message.includes('#2'), 'decode_failed names the failing row (entry_id 2)');
  });

  await test('checkCompressionCodec flags a compression value with no registered codec', async () => {
    const dbPath = tmpDbPath('bible-bad-codec');
    const db = new Database(dbPath);
    db.exec(loadSchemaSql(BIBLE_SCHEMA));
    db.prepare(`
      INSERT INTO module_info (
        info_id, module_uuid, module_type, abbreviation, full_name,
        format, format_version, content_version, content_sha256, compression,
        language_code, versification, license_spdx, source_url
      ) VALUES (1, ?, 'bible', 'BC', 'Bad Codec',
        'bible-module', '0.2', '1.0', NULL, 'brotli',
        'en', 'kjv-english', 'PD', 'https://example.test/bc')
    `).run(crypto.randomUUID());
    db.prepare('INSERT INTO bible_verse (verse_id, text) VALUES (1001001, ?)').run('In the beginning.');
    db.close();

    const result = await validateModule(dbPath, { canon });
    const codes = errorCodes(result);
    console.log(`  codes: ${JSON.stringify(codes)}`);
    assert(codes.includes('missing_codec'), "missing_codec fires for compression = 'brotli' (not in this build's registry)");
  });

  await test('checkCompressionDictionary flags a missing row and a stray one', async () => {
    // compression != 'none' with no dictionary row at all.
    const missingPath = tmpDbPath('commentary-no-dict');
    const missingDb = new Database(missingPath);
    missingDb.exec(loadSchemaSql(COMMENTARY_SCHEMA));
    missingDb.prepare(`
      INSERT INTO module_info (
        info_id, module_uuid, module_type, abbreviation, full_name,
        format, format_version, content_version, content_sha256, compression,
        language_code, versification, license_spdx, source_url
      ) VALUES (1, ?, 'commentary', 'ND', 'No Dictionary',
        'commentary-module', '0.2', '1.0', NULL, 'deflate',
        'en', 'kjv-english', 'PD', 'https://example.test/nd')
    `).run(crypto.randomUUID());
    missingDb.close();
    const missingResult = await validateModule(missingPath, { canon });
    const missingCodes = errorCodes(missingResult);
    console.log(`  no-dictionary codes: ${JSON.stringify(missingCodes)}`);
    assert(missingCodes.includes('missing_dictionary_row'), "missing_dictionary_row fires when compression != 'none' and no row exists");

    // compression = 'none' with a stray dictionary row anyway.
    const strayPath = tmpDbPath('commentary-stray-dict');
    const strayDb = new Database(strayPath);
    strayDb.exec(loadSchemaSql(COMMENTARY_SCHEMA));
    strayDb.prepare(`
      INSERT INTO module_info (
        info_id, module_uuid, module_type, abbreviation, full_name,
        format, format_version, content_version, content_sha256, compression,
        language_code, versification, license_spdx, source_url
      ) VALUES (1, ?, 'commentary', 'SD', 'Stray Dictionary',
        'commentary-module', '0.2', '1.0', NULL, 'none',
        'en', 'kjv-english', 'PD', 'https://example.test/sd')
    `).run(crypto.randomUUID());
    strayDb.prepare(
      'INSERT INTO compression_dictionary (codec, dict_id, dict_blob) VALUES (?, ?, ?)'
    ).run('deflate', 1, Buffer.from('stray'));
    strayDb.close();
    const strayResult = await validateModule(strayPath, { canon });
    const strayCodes = errorCodes(strayResult);
    console.log(`  stray-dictionary codes: ${JSON.stringify(strayCodes)}`);
    assert(strayCodes.includes('unexpected_dictionary_row'), "unexpected_dictionary_row fires when compression = 'none' but a row exists");
  });

  await test('checkContentSha256 flags a stored digest that does not recompute', async () => {
    const dbPath = tmpDbPath('bible-bad-digest');
    const db = new Database(dbPath);
    db.exec(loadSchemaSql(BIBLE_SCHEMA));
    db.prepare(`
      INSERT INTO module_info (
        info_id, module_uuid, module_type, abbreviation, full_name,
        format, format_version, content_version, content_sha256, compression,
        language_code, versification, license_spdx, source_url
      ) VALUES (1, ?, 'bible', 'BD', 'Bad Digest',
        'bible-module', '0.2', '1.0', ?, 'none',
        'en', 'kjv-english', 'PD', 'https://example.test/bd')
    `).run(crypto.randomUUID(), '0'.repeat(64));
    db.prepare('INSERT INTO bible_verse (verse_id, text) VALUES (1001001, ?)').run('In the beginning.');
    db.close();

    const result = await validateModule(dbPath, { canon });
    const codes = errorCodes(result);
    console.log(`  codes: ${JSON.stringify(codes)}`);
    assert(codes.includes('content_sha256_mismatch'), 'content_sha256_mismatch fires for a stored hash of all zeros');
  });

  cleanup();

  console.log(`\n${passCount} assertion(s) passed, ${failCount} test(s) failed.`);
  if (failCount > 0) {
    process.exit(1);
  }
}

main().catch(e => {
  cleanup();
  console.error('Fatal error running self-test:', e);
  process.exit(1);
});
