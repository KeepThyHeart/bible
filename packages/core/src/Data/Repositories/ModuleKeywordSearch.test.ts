/**
 * Which FTS5 table a content repository's search MATCHes against
 * (`BaseModuleRepository.keywordIndexTable()`), and the helper that builds the
 * sidecar for it (`ensureModuleKeywordIndexes()`).
 *
 * Module schema v0.2 ships no `*_fts` table. A v0.2 module is searched through
 * the sidecar `.kwi` the configured `SidecarFts5Provider` built for its exact
 * revision; a v0.1 module that still carries its own table keeps using that.
 * Uses small on-disk fixtures - a sidecar is addressed by file - so it runs
 * without any real module data installed.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CommentaryRepository } from './CommentaryRepository';
import { ensureModuleKeywordIndexes } from './ModuleKeywordIndexes';
import { TestSqliteProvider } from '../../__tests__/helpers/TestSqliteProvider';
import { openTestSidecarDatabase } from '../../__tests__/helpers/TestSidecarDatabase';
import { loadSchemaSql } from '../Schema';
import { DeflateCodec } from '../Access/Codec';
import { SidecarFts5Provider } from '../Access/Fts5/SidecarFts5Provider';
import { configureModuleKeywordIndex, moduleKeywordIndex } from '../Access/Fts5/ModuleKeywordIndex';
import { TEST_DICTIONARY } from '../../__tests__/helpers/codecFixtures';

const COMMENTARY_SCHEMA = join(__dirname, '..', '..', '..', 'sql', 'schemas', 'initial', 'Commentary.sql');

const ENTRIES: Array<[number, string]> = [
  [43003016, '<p>For God so <b>loved</b> the world, that he gave his only begotten Son.</p>'],
  [43003017, '<p>God sent not his Son into the world to condemn the world.</p>'],
  [45005008, '<p>But God commendeth his love toward us.</p>'],
];

/** Whatever the per-worker setup configured; restored after this file. */
const configuredBefore = moduleKeywordIndex();
afterAll(() => configureModuleKeywordIndex(configuredBefore));

let dir: string;
let indexDir: string;
let provider: SidecarFts5Provider;
const open: TestSqliteProvider[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'module-keyword-search-'));
  indexDir = join(dir, 'keyword-index');
  mkdirSync(indexDir);
  provider = new SidecarFts5Provider({ indexDir, openDatabase: openTestSidecarDatabase });
  configureModuleKeywordIndex(provider);
});

afterEach(() => {
  while (open.length > 0) open.pop()!.close();
  rmSync(dir, { recursive: true, force: true });
});

/**
 * A v0.2 commentary on disk: deflate-compressed with a dictionary, like the
 * published ones, so building its index exercises decoding too. `legacyFts`
 * adds a v0.1-style `commentary_entry_fts` holding only `legacyText`, so a
 * test can tell which index answered.
 */
function writeModule(name: string, options: { legacyFts?: boolean } = {}): string {
  const path = join(dir, name);
  const sql = new TestSqliteProvider(path);
  sql.exec(loadSchemaSql(COMMENTARY_SCHEMA));
  sql.execute(
    `INSERT INTO module_info (info_id, module_uuid, module_type, abbreviation, full_name,
                              format, format_version, language_code, compression, content_sha256)
     VALUES (1, ?, 'commentary', 'FIX', 'Fixture', 'commentary-module', '0.2', 'en', 'deflate', ?)`,
    [`uuid-${name.replace(/\W/g, '')}`, 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2']
  );
  sql.execute(`INSERT INTO compression_dictionary (codec, dict_id, dict_blob) VALUES ('deflate', 1, ?)`, [
    TEST_DICTIONARY,
  ]);
  const codec = new DeflateCodec(TEST_DICTIONARY);
  for (const [verseId, text] of ENTRIES) {
    sql.execute(
      `INSERT INTO commentary_entry (verse_id_start, verse_id_end, entry_level, content) VALUES (?, ?, 'verse', ?)`,
      [verseId, verseId, codec.encode(text)]
    );
  }
  if (options.legacyFts) {
    sql.exec(`CREATE VIRTUAL TABLE commentary_entry_fts USING fts5(entry_id UNINDEXED, content)`);
    sql.execute(`INSERT INTO commentary_entry_fts(rowid, entry_id, content) VALUES (3, 3, 'legacyonlyword')`);
  }
  sql.close();
  return path;
}

function repoFor(path: string): CommentaryRepository {
  const sql = new TestSqliteProvider(path, { readonly: true });
  open.push(sql);
  return new CommentaryRepository(sql);
}

const build = (paths: string[]) =>
  ensureModuleKeywordIndexes({
    provider,
    modulePaths: paths,
    openModule: (p) => new TestSqliteProvider(p, { readonly: true }),
  });

describe('keyword search over a v0.2 module (no in-module FTS5 table)', () => {
  it('finds nothing - rather than throwing - while its sidecar is unbuilt', () => {
    const repo = repoFor(writeModule('a.db'));
    expect(repo.searchEntries('world')).toEqual([]);
  });

  it('finds nothing when no sidecar provider is configured at all', async () => {
    const path = writeModule('a.db');
    await build([path]);
    configureModuleKeywordIndex(null);
    expect(repoFor(path).searchEntries('world')).toEqual([]);
  });

  it('searches the built sidecar, including content that was stored compressed', async () => {
    const path = writeModule('a.db');
    const result = await build([path]);
    expect(result.built).toEqual([path]);

    const hits = repoFor(path).searchEntries('world');
    expect(hits.map((e) => e.verseIdStart)).toEqual([43003016, 43003017]);
    // Stemmed and markup-free: "love" finds "loved" inside <b>...</b>.
    expect(repoFor(path).searchEntries('love').map((e) => e.verseIdStart)).toEqual([43003016, 45005008]);
  });

  it('keeps working when the index is built after the repository first searched', async () => {
    const path = writeModule('a.db');
    const repo = repoFor(path);
    expect(repo.searchEntries('world')).toEqual([]);

    await build([path]);
    expect(repo.searchEntries('world')).toHaveLength(2);
  });

  it('leaves a current index alone on the next ensure', async () => {
    const path = writeModule('a.db');
    await build([path]);
    const again = await build([path]);
    expect(again.built).toEqual([]);
    expect(again.current).toEqual([path]);
  });
});

describe('keyword search over a v0.1 module (ships commentary_entry_fts)', () => {
  it('uses its own table, not a sidecar, and ensure leaves it alone', async () => {
    const path = writeModule('legacy.db', { legacyFts: true });
    const result = await build([path]);
    expect(result.notApplicable).toEqual([path]);

    const repo = repoFor(path);
    expect(repo.searchEntries('legacyonlyword').map((e) => e.entryId)).toEqual([3]);
    expect(repo.searchEntries('world')).toEqual([]);
  });
});
