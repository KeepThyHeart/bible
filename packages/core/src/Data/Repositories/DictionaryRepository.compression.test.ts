/**
 * A dictionary module whose `definition` / `usage_notes` cells are compressed BLOB frames (B-049).
 * Webster's 1828 ships this way; before the fix `mapRowToEntry` handed the raw Buffer to the UI,
 * which then crashed on `definition.replace`.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { join } from 'node:path';
import { DictionaryRepository } from './DictionaryRepository';
import { TestSqliteProvider } from '../../__tests__/helpers/TestSqliteProvider';
import { loadSchemaSql } from '../Schema';
import { DeflateCodec } from '../Access/Codec';
import { CODEC_CORPUS, TEST_DICTIONARY } from '../../__tests__/helpers/codecFixtures';

const SCHEMA = join(__dirname, '..', '..', '..', 'sql', 'schemas', 'initial', 'Dictionary.sql');
const open: TestSqliteProvider[] = [];
afterEach(() => { while (open.length > 0) open.pop()!.close(); });

function makeModule(): TestSqliteProvider {
  const sql = new TestSqliteProvider(':memory:');
  open.push(sql);
  sql.exec(loadSchemaSql(SCHEMA));
  sql.execute(
    `INSERT INTO module_info (info_id, module_uuid, module_type, abbreviation, full_name,
                              format, format_version, language_code, compression)
     VALUES (1, 'fixture-uuid', 'dictionary', 'FIX', 'Fixture Dictionary',
             'dictionary-module', '0.2', 'en', 'deflate')`,
  );
  sql.execute(`INSERT INTO compression_dictionary (codec, dict_id, dict_blob) VALUES ('deflate', 1234, ?)`, [TEST_DICTIONARY]);
  const codec = new DeflateCodec(TEST_DICTIONARY);
  // One compressed entry and one short entry the publisher left as plain text.
  sql.execute(
    `INSERT INTO dictionary_entry (entry_id, entry_key, word, definition, usage_notes) VALUES (1, 'ZEAL', 'ZEAL', ?, ?)`,
    [codec.encode(CODEC_CORPUS.prose), codec.encode(CODEC_CORPUS.utf8)],
  );
  sql.execute(`INSERT INTO dictionary_entry (entry_id, entry_key, word, definition) VALUES (2, 'ZEST', 'ZEST', 'Relish.')`);
  return sql;
}

describe('DictionaryRepository with compressed content (B-049)', () => {
  it('decodes definition and usage notes into strings on every read path', () => {
    const repo = new DictionaryRepository(makeModule());
    for (const e of [repo.getEntry(1)!, repo.getEntryByKey('ZEAL')!, repo.getAllEntries()[0], repo.searchEntries('ZEAL')[0]]) {
      expect(typeof e.definition).toBe('string');
      expect(e.definition).toBe(CODEC_CORPUS.prose);
      expect(e.usageNotes).toBe(CODEC_CORPUS.utf8);
    }
  });

  it('keeps plain-text cells of a compressed module as they are', () => {
    expect(new DictionaryRepository(makeModule()).getEntry(2)!.definition).toBe('Relish.');
  });
});
