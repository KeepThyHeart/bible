import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { WORD_GROUP_COLLECTION, WORD_GROUP_OWNER } from '@bible/core/browser';
import { resetUserDataForTests } from '../userdata/userData';
import { listWordGroups, saveWordGroup, removeWordGroup, WORD_GROUPS_KEY } from './wordGroupStorage';

async function fresh(factory = new IDBFactory()) {
  const store = await resetUserDataForTests({ indexedDB: factory, channelName: null });
  return { store: store!, factory };
}

beforeEach(() => localStorage.clear());
afterEach(async () => {
  await resetUserDataForTests();
});

describe('wordGroupStorage (user-data store)', () => {
  it('starts empty', async () => {
    await fresh();
    expect(await listWordGroups()).toEqual([]);
  });

  it('saves, replaces by id and removes, under app:word-study', async () => {
    const { store } = await fresh();
    const a = await saveWordGroup({ id: 'g1', label: 'Love', terms: ['love', 'lov*'] });
    expect(a.id).toBe('g1');
    await saveWordGroup({ id: 'g2', label: 'Faith', terms: ['faith'] });
    await saveWordGroup({ id: 'g1', label: 'Love 2', terms: ['love'] });
    expect((await listWordGroups()).map((g) => g.label)).toEqual(['Faith', 'Love 2']);
    expect(store.items.list(WORD_GROUP_OWNER, WORD_GROUP_COLLECTION).map((i) => i.itemKey).sort()).toEqual(['g1', 'g2']);
    await removeWordGroup('g1');
    expect((await listWordGroups()).map((g) => g.id)).toEqual(['g2']);
  });

  it('assigns an id to a new group', async () => {
    await fresh();
    const g = await saveWordGroup({ id: '', label: '', terms: ['grace'] });
    expect(g.id).toMatch(/^wg-/);
    expect(g.label).toBe('grace');
  });

  it('migrates legacy localStorage groups once, dropping invalid entries, and removes the key', async () => {
    localStorage.setItem(WORD_GROUPS_KEY, JSON.stringify([null, { id: 'x' }, { id: 'ok', label: 'ok', terms: ['ok'] }, { id: 'e', terms: [] }]));
    await fresh();
    expect((await listWordGroups()).map((g) => g.id)).toEqual(['ok']);
    expect(localStorage.getItem(WORD_GROUPS_KEY)).toBeNull();
    // A second read does not duplicate.
    expect(await listWordGroups()).toHaveLength(1);
  });

  it('leaves a corrupt legacy value in place and starts empty', async () => {
    localStorage.setItem(WORD_GROUPS_KEY, '{not json');
    await fresh();
    expect(await listWordGroups()).toEqual([]);
    expect(localStorage.getItem(WORD_GROUPS_KEY)).toBe('{not json');
  });

  it('is durable across a reopen', async () => {
    const { store: first, factory } = await fresh();
    await saveWordGroup({ id: 'g9', label: 'Grace', terms: ['grace'] });
    await first.flush();
    await fresh(factory);
    expect((await listWordGroups()).map((g) => g.id)).toEqual(['g9']);
  });
});
