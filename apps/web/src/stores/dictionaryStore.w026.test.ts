// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { dictionaryStore } from './dictionaryStore';

/** W-026: last request issued wins, not last to resolve. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((a) => { resolve = a; });
  return { promise, resolve };
}
const ok = (body: unknown) => ({ ok: true, json: async () => body });

describe('dictionaryStore stale-response guards (W-026)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    dictionaryStore.modules = [];
    dictionaryStore.modulesLoaded = true;
    dictionaryStore.tabs = [{ id: 'dtab-home', moduleAbbr: '__home__', moduleName: 'Home' }];
    dictionaryStore.tabStates.clear();
  });
  afterEach(() => vi.useRealTimers());

  it('home search: a slow earlier response does not overwrite a later one', async () => {
    const slow = deferred<any>();
    const fast = deferred<any>();
    globalThis.fetch = vi.fn((url: string) => (String(url).includes('q=lo') && !String(url).includes('q=love') ? slow.promise : fast.promise)) as any;
    dictionaryStore.setHomeSearchQuery('lo');
    await vi.advanceTimersByTimeAsync(400);
    dictionaryStore.setHomeSearchQuery('love');
    await vi.advanceTimersByTimeAsync(400);
    fast.resolve(ok([{ entry_key: 'love' }]));
    await vi.advanceTimersByTimeAsync(0);
    slow.resolve(ok([{ entry_key: 'lo' }]));
    await vi.advanceTimersByTimeAsync(0);
    expect((dictionaryStore.homeSuggestions as any[]).map((s) => s.entry_key)).toEqual(['love']);
  });

  it('tab search: a slow earlier response does not overwrite a later one', async () => {
    dictionaryStore.addTab('Easton', 'Easton');
    const id = dictionaryStore.activeTabId;
    const slow = deferred<any>();
    const fast = deferred<any>();
    globalThis.fetch = vi.fn((url: string) => (String(url).includes('q=ab') && !String(url).includes('q=abc') ? slow.promise : fast.promise)) as any;
    dictionaryStore.setTabSearchQuery(id, 'ab');
    await vi.advanceTimersByTimeAsync(400);
    dictionaryStore.setTabSearchQuery(id, 'abc');
    await vi.advanceTimersByTimeAsync(400);
    fast.resolve(ok([{ entry_key: 'abc' }]));
    await vi.advanceTimersByTimeAsync(0);
    slow.resolve(ok([{ entry_key: 'ab' }]));
    await vi.advanceTimersByTimeAsync(0);
    expect(dictionaryStore.getTabState(id).suggestions.map((s: any) => s.entry_key)).toEqual(['abc']);
  });

  it('loadEntryInTab: the later request wins even if it resolves first', async () => {
    dictionaryStore.addTab('Easton', 'Easton');
    const id = dictionaryStore.activeTabId;
    const a = deferred<any>();
    const b = deferred<any>();
    globalThis.fetch = vi.fn((url: string) => {
      const u = String(url);
      if (u.includes('/adjacent/')) return Promise.resolve(ok({ prev: null, next: null }));
      return u.includes('/entry/A') ? a.promise : b.promise;
    }) as any;
    const p1 = dictionaryStore.loadEntryInTab(id, 'A');
    const p2 = dictionaryStore.loadEntryInTab(id, 'B');
    b.resolve(ok({ entry_key: 'B' }));
    await p2;
    a.resolve(ok({ entry_key: 'A' }));
    await p1;
    expect((dictionaryStore.getTabState(id).entry as any).entry_key).toBe('B');
  });
});
