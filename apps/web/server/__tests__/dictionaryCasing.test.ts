/** W-004: every casing of a dictionary name must share one connection. */
import { describe, it, expect, afterAll } from 'vitest';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { DatabaseManager } from '../DatabaseManager';
import { TEST_DATA_DIR, TEST_MODULES_DIR } from './testDataDir';

const have = existsSync(resolve(TEST_DATA_DIR, 'main.db'))
  && existsSync(resolve(TEST_MODULES_DIR, 'modules', 'dictionary_strongsgreek.db'));

describe.skipIf(!have)('DatabaseManager.getDictionaryRepo casing (W-004)', () => {
  const db = have ? new DatabaseManager(TEST_DATA_DIR, TEST_MODULES_DIR) : (null as unknown as DatabaseManager);
  afterAll(() => db?.closeAll());

  it('opens one connection for all casings', () => {
    const repos = ['strongsgreek', 'StrongsGreek', 'sTrongsgreek', 'STRONGSGREEK', 'stRongsgreek']
      .map(n => db.getDictionaryRepo(n));
    expect(repos[0]).not.toBeNull();
    expect(new Set(repos).size).toBe(1);
    expect((db as any).dictionaryDbs.size).toBe(1);
    expect(db.getDictionaryDb('sTrongsGREEK')).not.toBeNull();
  });

  it('refuses names that cannot be module abbreviations', () => {
    expect(db.getDictionaryRepo('../main')).toBeNull();
    expect(db.getDictionaryRepo('x'.repeat(500))).toBeNull();
  });
});
