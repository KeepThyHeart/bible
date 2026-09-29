import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { resetUserDataForTests } from '../userdata/userData';
import {
  LEGACY_STUDY_HISTORY_KEY,
  STUDY_HISTORY_COLLECTION,
  STUDY_HISTORY_OWNER,
  loadVerseHistory,
  saveVerseHistory,
} from './studyHistoryStorage';

async function fresh(factory = new IDBFactory()) {
  const store = await resetUserDataForTests({ indexedDB: factory, channelName: null });
  return { store: store!, factory };
}

beforeEach(() => localStorage.clear());
afterEach(async () => {
  await resetUserDataForTests();
});

describe('study verse history storage', () => {
  it('migrates the legacy localStorage array once and removes the old key', async () => {
    const legacy = [{ verseId: 43003016, timestamp: 200 }, { verseId: 1001001, timestamp: 100 }];
    localStorage.setItem(LEGACY_STUDY_HISTORY_KEY, JSON.stringify(legacy));
    await fresh();
        expect(await loadVerseHistory()).toEqual(legacy);
    expect(localStorage.getItem(LEGACY_STUDY_HISTORY_KEY)).toBeNull();
  });

  it('leaves a corrupt legacy value in place and starts empty', async () => {
    localStorage.setItem(LEGACY_STUDY_HISTORY_KEY, '{oops');
    await fresh();
        expect(await loadVerseHistory()).toEqual([]);
    expect(localStorage.getItem(LEGACY_STUDY_HISTORY_KEY)).toBe('{oops');
  });

  it('saves, orders newest first, and drops entries that are no longer listed', async () => {
    const { store } = await fresh();
        await saveVerseHistory([{ verseId: 2, timestamp: 20 }, { verseId: 1, timestamp: 10 }]);
    expect((await loadVerseHistory()).map((e) => e.verseId)).toEqual([2, 1]);
    await saveVerseHistory([{ verseId: 3, timestamp: 30 }, { verseId: 2, timestamp: 20 }]);
    expect((await loadVerseHistory()).map((e) => e.verseId)).toEqual([3, 2]);
    expect(store.items.list(STUDY_HISTORY_OWNER, STUDY_HISTORY_COLLECTION).map((i) => i.itemKey).sort()).toEqual(['2', '3']);
  });

  it('is durable across a reopen', async () => {
    const { store: first, factory } = await fresh();
    await saveVerseHistory([{ verseId: 5, timestamp: 50 }]);
    await first.flush();
    await fresh(factory);
    expect((await loadVerseHistory()).map((e) => e.verseId)).toEqual([5]);
  });
});
