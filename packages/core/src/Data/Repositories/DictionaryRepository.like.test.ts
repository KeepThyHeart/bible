/** W-051: `%` and `_` in a dictionary search are literal characters, not LIKE wildcards. */
import { describe, it, expect, afterEach } from 'vitest';
import { join } from 'node:path';
import { DictionaryRepository } from './DictionaryRepository';
import { TestSqliteProvider } from '../../__tests__/helpers/TestSqliteProvider';
import { loadSchemaSql } from '../Schema';

const SCHEMA = join(__dirname, '..', '..', '..', 'sql', 'schemas', 'initial', 'Dictionary.sql');
const open: TestSqliteProvider[] = [];
afterEach(() => { while (open.length > 0) open.pop()!.close(); });

function makeRepo(): DictionaryRepository {
  const sql = new TestSqliteProvider(':memory:');
  open.push(sql);
  sql.exec(loadSchemaSql(SCHEMA));
  sql.execute(
    `INSERT INTO module_info (info_id, module_uuid, module_type, abbreviation, full_name, format, format_version, language_code)
     VALUES (1, 'fixture-uuid', 'dictionary', 'FIX', 'Fixture Dictionary', 'dictionary-module', '0.2', 'en')`,
  );
  const rows: Array<[number, string]> = [[1, 'AARON'], [2, 'ABBA'], [3, 'A_B'], [4, '50%'], [5, 'BACK\\SLASH']];
  for (const [id, word] of rows) {
    sql.execute(`INSERT INTO dictionary_entry (entry_id, entry_key, word, definition) VALUES (?, ?, ?, 'd')`, [id, word, word]);
  }
  return new DictionaryRepository(sql);
}

describe('DictionaryRepository LIKE escaping (W-051)', () => {
  it('a search for % or _ matches only entries containing that character', () => {
    const repo = makeRepo();
    expect(repo.searchByTitle('%').map(e => e.word)).toEqual(['50%']);
    expect(repo.searchByTitle('_').map(e => e.word)).toEqual(['A_B']);
    expect(repo.searchEntries('%').map(e => e.word)).toEqual(['50%']);
    expect(repo.searchByTitle('\\').map(e => e.word)).toEqual(['BACK\\SLASH']);
  });

  it('ordinary searches are unchanged', () => {
    const repo = makeRepo();
    expect(repo.searchByTitle('a').map(e => e.word)).toContain('AARON');
    expect(repo.searchByTitle('ab')[0].word).toBe('ABBA');
  });
});

describe('DictionaryRepository stemmed title tier (B15)', () => {
  function stemRepo(): DictionaryRepository {
    const sql = new TestSqliteProvider(':memory:');
    open.push(sql);
    sql.exec(loadSchemaSql(SCHEMA));
    sql.execute(
      `INSERT INTO module_info (info_id, module_uuid, module_type, abbreviation, full_name, format, format_version, language_code)
       VALUES (1, 'u', 'dictionary', 'FIX', 'Fixture', 'dictionary-module', '0.2', 'en')`,
    );
    ['WALK', 'WALKED', 'BELIEVE', 'BELIEF', 'G25'].forEach((w, i) =>
      sql.execute(`INSERT INTO dictionary_entry (entry_id, entry_key, word, definition) VALUES (?, ?, ?, 'd')`, [i + 1, w, w]));
    return new DictionaryRepository(sql);
  }

  it('walking finds WALK, once', () => {
    const words = stemRepo().searchEntries('walking').map(e => e.word);
    expect(words[0]).toBe('WALK');
    expect(words.filter(w => w === 'WALK')).toHaveLength(1);
  });

  it('believed finds BELIEVE', () => {
    expect(stemRepo().searchEntries('believed').map(e => e.word)).toContain('BELIEVE');
  });

  it('exact and Strong\'s lookups are unchanged', () => {
    expect(stemRepo().searchEntries('walk')[0].word).toBe('WALK');
    expect(stemRepo().searchEntries('G25').map(e => e.word)).toEqual(['G25']);
  });
});
