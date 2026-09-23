import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MainTestHelper } from './helpers/MainTestHelper';
import { KeywordIndexRepository } from '../Data/Repositories/KeywordIndexRepository';
import { KeywordIndexRecord } from '../Data/Repositories/IKeywordIndexRepository';

const PROVIDER_ID = 'sidecar-fts5';

function record(overrides: Partial<KeywordIndexRecord> = {}): KeywordIndexRecord {
  return {
    moduleUuid: overrides.moduleUuid ?? 'module-a',
    providerId: overrides.providerId ?? PROVIDER_ID,
    contentSha256: overrides.contentSha256 ?? 'a'.repeat(64),
    state: overrides.state ?? 'building',
    tokenizer: overrides.tokenizer ?? 'porter unicode61',
    docCount: overrides.docCount ?? null,
    sizeBytes: overrides.sizeBytes ?? null,
    builtAt: overrides.builtAt ?? null,
    error: overrides.error ?? null,
  };
}

describe('KeywordIndexRepository', () => {
  let repo: KeywordIndexRepository;

  beforeAll(() => {
    MainTestHelper.initializeWithFullSchema();
    repo = new KeywordIndexRepository(MainTestHelper.getProvider());
  });

  afterAll(() => {
    MainTestHelper.cleanup();
  });

  beforeEach(() => {
    MainTestHelper.clearData();
  });

  it('reports undefined for a module that has never been indexed', () => {
    expect(repo.get('nonexistent', PROVIDER_ID)).toBeUndefined();
  });

  it('round-trips a freshly inserted record', () => {
    repo.upsert(record({ state: 'building' }));

    const found = repo.get('module-a', PROVIDER_ID);
    expect(found).toEqual(record({ state: 'building' }));
  });

  it('walks the state machine unbuilt -> building -> ready via successive upserts', () => {
    repo.upsert(record({ state: 'building' }));
    repo.upsert(record({
      state: 'ready',
      docCount: 12345,
      sizeBytes: 987654,
      builtAt: '2026-01-01T00:00:00.000Z',
    }));

    const found = repo.get('module-a', PROVIDER_ID);
    expect(found?.state).toBe('ready');
    expect(found?.docCount).toBe(12345);
    expect(found?.sizeBytes).toBe(987654);
    expect(found?.builtAt).toBe('2026-01-01T00:00:00.000Z');
    expect(found?.error).toBeNull();
  });

  it('records a failed build with its reason, clearing doc/size/built_at', () => {
    repo.upsert(record({ state: 'building' }));
    repo.upsert(record({
      state: 'failed',
      error: 'disk full',
      docCount: null,
      sizeBytes: null,
      builtAt: null,
    }));

    const found = repo.get('module-a', PROVIDER_ID);
    expect(found?.state).toBe('failed');
    expect(found?.error).toBe('disk full');
    expect(found?.docCount).toBeNull();
  });

  it('upsert does not disturb a different (moduleUuid, providerId) pair', () => {
    repo.upsert(record({ moduleUuid: 'module-a' }));
    repo.upsert(record({ moduleUuid: 'module-b' }));

    repo.upsert(record({ moduleUuid: 'module-a', state: 'ready' }));

    expect(repo.get('module-a', PROVIDER_ID)?.state).toBe('ready');
    expect(repo.get('module-b', PROVIDER_ID)?.state).toBe('building');
  });

  it('two providers may each hold a record for the same module', () => {
    repo.upsert(record({ moduleUuid: 'module-a', providerId: 'sidecar-fts5', state: 'ready' }));
    repo.upsert(record({ moduleUuid: 'module-a', providerId: 'shared-fts5', state: 'building' }));

    expect(repo.get('module-a', 'sidecar-fts5')?.state).toBe('ready');
    expect(repo.get('module-a', 'shared-fts5')?.state).toBe('building');
  });

  it('delete removes the record; a repeat delete is a no-op', () => {
    repo.upsert(record());
    repo.delete('module-a', PROVIDER_ID);

    expect(repo.get('module-a', PROVIDER_ID)).toBeUndefined();
    expect(() => repo.delete('module-a', PROVIDER_ID)).not.toThrow();
  });
});
