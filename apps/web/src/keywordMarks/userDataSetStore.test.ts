import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { BUILT_IN_KEYWORD_SETS, type KeywordSet } from '@bible/core/browser';
import { resetUserDataForTests } from '../userdata/userData';
import { LEGACY_KEYWORD_SETS_KEY, WebKeywordSetStore } from './userDataSetStore';

const SET: KeywordSet = {
  schema: 1, id: 'set-1', name: 'Mine', scope: { kind: 'everywhere' }, updatedAt: '2026-01-01T00:00:00.000Z',
  marks: [{
    id: 'm1', label: 'God', rule: { kind: 'word', forms: ['God'] },
    style: { color: 'mark.1', line: 'solid' }, enabled: true,
  }],
};

beforeEach(async () => {
  localStorage.clear();
});
afterEach(async () => {
  await resetUserDataForTests();
});

describe('WebKeywordSetStore', () => {
  it('round-trips a set through the user-data store', async () => {
    await resetUserDataForTests({ indexedDB: new IDBFactory(), channelName: null });
    const store = new WebKeywordSetStore();
    await store.put(SET);
    expect((await store.list()).map((s) => s.id)).toEqual(['set-1']);
    await store.remove('set-1');
    expect(await store.list()).toEqual([]);
  });

  it('migrates the legacy localStorage array once, dropping built-ins and invalid sets', async () => {
    localStorage.setItem(LEGACY_KEYWORD_SETS_KEY, JSON.stringify([SET, { nope: true }, BUILT_IN_KEYWORD_SETS[0]]));
    await resetUserDataForTests({ indexedDB: new IDBFactory(), channelName: null });
    const store = new WebKeywordSetStore();
    expect((await store.list()).map((s) => s.id)).toEqual(['set-1']);
    expect(localStorage.getItem(LEGACY_KEYWORD_SETS_KEY)).toBeNull();
  });

  it('leaves a corrupt legacy value in place', async () => {
    localStorage.setItem(LEGACY_KEYWORD_SETS_KEY, '{oops');
    await resetUserDataForTests({ indexedDB: new IDBFactory(), channelName: null });
    expect(await new WebKeywordSetStore().list()).toEqual([]);
    expect(localStorage.getItem(LEGACY_KEYWORD_SETS_KEY)).toBe('{oops');
  });
});
