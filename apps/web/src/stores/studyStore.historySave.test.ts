/**
 * Soak WV-03: a jump made before the stored verse history finished loading
 * must not delete the older stored entries (the stored list shrank 6, 4, 1...).
 */
import { describe, it, expect, vi } from 'vitest';

const h = vi.hoisted(() => ({
  order: [] as string[],
  resolveLoad: (_v: Array<{ verseId: number; timestamp: number }>) => {},
}));

vi.mock('./studyHistoryStorage', () => ({
  loadVerseHistory: () => new Promise((r) => { h.resolveLoad = r as typeof h.resolveLoad; h.order.push('load-started'); }),
  saveVerseHistory: vi.fn(async (entries: Array<{ verseId: number }>) => { h.order.push(`save:${entries.map((e) => e.verseId).join(',')}`); }),
}));
vi.mock('../userdata/userData', () => ({ getUserData: () => new Promise(() => {}) }));
vi.mock('./bibleStore', () => ({ bibleStore: { getActiveTab: () => null, fetchVerse: vi.fn() } }));

import { studyStore } from './studyStore';

describe('verse history saving', () => {
  it('waits for the stored history to load, then saves the merged list', async () => {
    studyStore.init({ crossRef: {}, topical: {}, interlinear: {}, studyOverview: {} } as never);
    studyStore.loadForVerse(43003016, 43, 3, 16); // a jump before the load finished
    await Promise.resolve();
    expect(h.order).toEqual(['load-started']);
    h.resolveLoad([{ verseId: 1001001, timestamp: 1 }, { verseId: 19023001, timestamp: 2 }]);
    await new Promise((r) => setTimeout(r, 20));
    const saves = h.order.filter((o) => o.startsWith('save:'));
    expect(saves).toHaveLength(1);
    expect(saves[0]).toContain('43003016');
    expect(saves[0]).toContain('1001001');
    expect(saves[0]).toContain('19023001');
  });
});
