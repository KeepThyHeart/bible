import type { ICommentaryDataProvider } from '../providers/interfaces';
import type { CommentaryEntryData } from '../types';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { commentaryStore, HOME_TAB_ID } from './commentaryStore';

/**
 * The Commentary pane used to get permanently stuck on "Loading commentary…".
 *
 * `loading` was one store-wide boolean shared by every tab, and the only thing
 * that lowered it for a chapter load was `_backgroundLoadTab` — which cleared
 * it *only when the module it had just fetched was the one on screen*. Switch
 * tabs while a fetch is out and the response arrives for the wrong module: it
 * refuses to lower the flag, and nothing else ever will. `setActiveTab` then
 * made it worse by returning early "because a load is already in progress",
 * on the false premise that a completing request would pick up whatever tab
 * had become active — it does not; it can only paint the module it fetched.
 *
 * These tests drive the store the way the reported repro does, with the fetch
 * promises resolved by hand: everything resolving immediately hides the bug,
 * because the interleaving *is* the bug.
 */

interface Deferred {
  promise: Promise<{ entries: CommentaryEntryData[] }>;
  resolve: (entries: CommentaryEntryData[]) => void;
  reject: (error: Error) => void;
}

function deferred(): Deferred {
  let resolve!: (entries: CommentaryEntryData[]) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<{ entries: CommentaryEntryData[] }>((res, rej) => {
    resolve = (entries) => res({ entries });
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A commentary entry pinned to a single verse id. */
function entryFor(verseId: number): CommentaryEntryData {
  return {
    entry_id: verseId,
    verse_id_start: verseId,
    verse_id_end: verseId,
    entry_level: 'verse',
    content: 'text',
    word_count: 1,
  };
}

/**
 * Inject a stub commentary provider.
 *
 * `provider` is private on `CommentaryStore`, and these tests want it without
 * `init()`'s session restore and tab seeding — so the modifier has to be
 * stepped past. Same helper as the sibling store tests.
 */
function setProvider(stub: Partial<ICommentaryDataProvider>): void {
  (commentaryStore as unknown as { provider: ICommentaryDataProvider }).provider =
    stub as ICommentaryDataProvider;
}

/**
 * Drop any requests a previous test left registered as in flight.
 *
 * `loading` is derived from this register, so it is what a test resets instead
 * of the old boolean. Private for the same reason `provider` is — stepped past
 * here rather than widened on the store.
 */
function resetInFlight(): void {
  (commentaryStore as unknown as { _inFlightByModule: Map<string, number> })._inFlightByModule.clear();
}

/** Let queued promise continuations run without advancing wall-clock time. */
function flush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

describe('commentaryStore per-tab loading', () => {
  /** Pending chapter fetches, keyed by module. */
  let pending: Map<string, Deferred>;
  let getCommentary: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    pending = new Map();
    getCommentary = vi.fn((moduleAbbr: string) => {
      const d = deferred();
      pending.set(moduleAbbr, d);
      return d.promise;
    });
    setProvider({ getCommentary: getCommentary as unknown as ICommentaryDataProvider['getCommentary'] });

    commentaryStore.tabs = [
      { id: HOME_TAB_ID, moduleAbbr: '__home__', moduleName: 'Overview' },
      { id: 'ctab-1', moduleAbbr: 'SYNTHESIS', moduleName: 'Combined Summary' },
    ];
    commentaryStore.activeTabId = 'ctab-1';
    commentaryStore.entries = [];
    commentaryStore.entriesByTab.clear();
    commentaryStore.syncedBook = null;
    commentaryStore.syncedChapter = null;
    commentaryStore.homeData = null;
    commentaryStore.homeLoading = false;
    resetInFlight();
  });

  it('clears the spinner when the tab that raised it is no longer the visible one', async () => {
    // The reported repro. John 3 loads with Combined Summary on screen…
    await commentaryStore.loadForChapter(43, 3);
    expect(commentaryStore.loading).toBe(true);

    // …the reader switches to the Overview tab while that fetch is still out…
    commentaryStore.setActiveTab(HOME_TAB_ID);
    pending.get('SYNTHESIS')?.resolve([entryFor(43003016)]);
    await flush();

    // …expands a module there, which warms its cache (what fetchModuleEntries
    // does), and clicks "Add to tabs".
    commentaryStore.entriesByTab.set('Barnes', [entryFor(43003016)]);
    commentaryStore.addTab('Barnes', 'Barnes', 43003016);

    // Barnes has its entries in hand; nothing is in flight for it.
    expect(commentaryStore.entries).toHaveLength(1);
    expect(commentaryStore.loading).toBe(false);
  });

  it('starts a load for a newly activated tab even while another module is still fetching', async () => {
    // Barnes is pinned, so the chapter load deliberately skips it and it has no
    // cache — exactly the case `setActiveTab`'s "a load is already in progress"
    // early return abandoned.
    commentaryStore.tabs.push({
      id: 'ctab-2', moduleAbbr: 'Barnes', moduleName: 'Barnes',
      pinned: true, pinnedBook: 43, pinnedChapter: 3, pinnedVerse: null,
    });

    await commentaryStore.loadForChapter(43, 3);
    expect(commentaryStore.loading).toBe(true);   // waiting on SYNTHESIS

    commentaryStore.setActiveTab('ctab-2');
    // Barnes must have a request of its own now — the SYNTHESIS response can
    // never fill this tab.
    expect(getCommentary.mock.calls.some(([abbr]) => abbr === 'Barnes')).toBe(true);

    pending.get('SYNTHESIS')?.resolve([entryFor(43003016)]);
    await flush();
    // Still spinning, but on Barnes' own request rather than forever.
    expect(commentaryStore.loading).toBe(true);

    pending.get('Barnes')?.resolve([entryFor(43003016)]);
    await flush();
    expect(commentaryStore.loading).toBe(false);
    expect(commentaryStore.entries).toHaveLength(1);
  });

  it('does not spin on a tab whose own fetch already landed', async () => {
    commentaryStore.tabs.push({ id: 'ctab-2', moduleAbbr: 'Barnes', moduleName: 'Barnes' });

    await commentaryStore.loadForChapter(43, 3);
    // Barnes lands first; the reader is still on Combined Summary.
    pending.get('Barnes')?.resolve([entryFor(43003016)]);
    await flush();
    expect(commentaryStore.loading).toBe(true);   // SYNTHESIS is still out

    commentaryStore.setActiveTab('ctab-2');
    expect(commentaryStore.loading).toBe(false);
    expect(commentaryStore.entries).toHaveLength(1);

    // And the slow SYNTHESIS response must not resurrect the spinner or
    // overwrite what Barnes is showing.
    pending.get('SYNTHESIS')?.resolve([entryFor(43003017)]);
    await flush();
    expect(commentaryStore.loading).toBe(false);
    expect(commentaryStore.entries).toEqual([entryFor(43003016)]);
  });

  it('keeps spinning on the new chapter when the previous chapter\'s response lands late', async () => {
    await commentaryStore.loadForChapter(43, 3);
    const stale = pending.get('SYNTHESIS');

    await commentaryStore.loadForChapter(43, 4);
    const fresh = pending.get('SYNTHESIS');
    expect(fresh).not.toBe(stale);

    // The abandoned John 3 response must neither paint John 3's entries nor
    // retire the spinner the John 4 request is still holding up.
    stale?.resolve([entryFor(43003016)]);
    await flush();
    expect(commentaryStore.loading).toBe(true);
    expect(commentaryStore.entries).toEqual([]);

    fresh?.resolve([entryFor(43004001)]);
    await flush();
    expect(commentaryStore.loading).toBe(false);
    expect(commentaryStore.entries).toEqual([entryFor(43004001)]);
  });

  it('holds the spinner through the chapter upgrade when the per-verse fetch comes back empty', async () => {
    // "Add to tabs" passes the selected verse, so the new tab takes the
    // per-verse fast path first. A verse the module says nothing about must not
    // read as a settled "No commentary for this verse" while the full-chapter
    // request behind it is still out.
    const verseFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ entries: [] }) });
    vi.stubGlobal('fetch', verseFetch);

    await commentaryStore.loadForChapter(43, 3);
    pending.get('SYNTHESIS')?.resolve([]);
    await flush();

    commentaryStore.addTab('Barnes', 'Barnes', 43003016);
    expect(commentaryStore.loading).toBe(true);

    await flush();
    expect(verseFetch).toHaveBeenCalled();
    expect(commentaryStore.loading).toBe(true);

    pending.get('Barnes')?.resolve([entryFor(43003016)]);
    await flush();
    expect(commentaryStore.loading).toBe(false);
    expect(commentaryStore.entries).toEqual([entryFor(43003016)]);

    vi.unstubAllGlobals();
  });

  it('lowers the spinner when a background fetch fails on a tab the reader has left', async () => {
    // The store logs the failure; the test asserts the recovery, not the noise.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    commentaryStore.tabs.push({ id: 'ctab-2', moduleAbbr: 'Barnes', moduleName: 'Barnes' });

    await commentaryStore.loadForChapter(43, 3);
    commentaryStore.setActiveTab('ctab-2');

    pending.get('SYNTHESIS')?.reject(new Error('network down'));
    pending.get('Barnes')?.reject(new Error('network down'));
    await flush();

    expect(commentaryStore.loading).toBe(false);
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});
