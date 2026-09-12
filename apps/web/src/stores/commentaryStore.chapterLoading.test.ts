import type { ICommentaryDataProvider } from '../providers/interfaces';
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { commentaryStore, HOME_TAB_ID, RESTORABLE_PANE_MODES } from './commentaryStore';

/**
 * Switching chapters used to flash "No commentary for this verse".
 *
 * `_loadChapter` moved `syncedBook`/`syncedChapter` to the new chapter and
 * notified, but left `entries` holding the OLD chapter's data with `loading`
 * still false. CommentaryContent then filtered those stale entries against a
 * verse id from the new chapter, matched nothing, and rendered the empty state
 * — until the background fetch landed a moment later.
 *
 * These tests pin the invariant that during a chapter change the pane is either
 * showing entries for the current chapter or is explicitly loading, never an
 * empty state built from another chapter's data.
 */

interface FakeProvider {
  getCommentary: Mock;
}

function resetStore(provider: FakeProvider): void {
  setProvider(provider);
  commentaryStore.tabs = [
    { id: HOME_TAB_ID, moduleAbbr: '__home__', moduleName: 'Overview' },
    { id: 'ctab-1', moduleAbbr: 'Barnes', moduleName: 'Barnes' },
  ];
  commentaryStore.activeTabId = 'ctab-1';
  commentaryStore.entries = [];
  resetInFlight();
  commentaryStore.entriesByTab.clear();
  commentaryStore.syncedBook = null;
  commentaryStore.syncedChapter = null;
  // These tests are about what the pane shows while a chapter loads, so the
  // pane is on screen. Without this the store correctly declines to fetch
  // anything — see `_viewMounted`.
  commentaryStore.viewMounted(true);
}

/** A commentary entry pinned to a single verse id. */
function entryFor(verseId: number) {
  return { verse_id_start: verseId, verse_id_end: verseId, content: 'text' };
}

/**
 * Inject a stub commentary provider.
 *
 * `provider` is private on `CommentaryStore`, and these tests want it without
 * `init()`'s session restore and tab seeding — so the modifier has to be
 * stepped past. Confined to this one commented helper rather than repeated at
 * every call site; TypeScript only began flagging it when test files entered
 * the type-check.
 */
function setProvider(stub: Partial<ICommentaryDataProvider>): void {
  (commentaryStore as unknown as { provider: ICommentaryDataProvider }).provider =
    stub as ICommentaryDataProvider;
}

/**
 * Drop any requests a previous test left registered as in flight.
 *
 * `loading` is a getter over that register now — a request can only clear the
 * spinner it raised — so resetting it is what resetting the old boolean was.
 * Private for the same reason `provider` is; see the note above.
 */
function resetInFlight(): void {
  (commentaryStore as unknown as { _inFlightByModule: Map<string, number> })._inFlightByModule.clear();
}

describe('commentaryStore chapter loading', () => {
  let provider: FakeProvider;

  beforeEach(() => {
    provider = { getCommentary: vi.fn() };
    resetStore(provider);
  });

  it('clears stale entries and raises loading before the fetch resolves', async () => {
    // Pretend the previous chapter (John 3) is on screen.
    commentaryStore.entries = [entryFor(43003016)] as never;

    let releaseFetch: (() => void) | undefined;
    provider.getCommentary.mockReturnValue(new Promise(resolve => {
      releaseFetch = () => resolve({ entries: [entryFor(43004001)] });
    }));

    const load = commentaryStore.loadForChapter(43, 4);

    // Synchronously after the navigation, before anything has resolved.
    expect(commentaryStore.entries).toEqual([]);
    expect(commentaryStore.loading).toBe(true);

    releaseFetch?.();
    await load;
    await Promise.resolve();
  });

  it('lowers loading once the chapter fetch resolves', async () => {
    provider.getCommentary.mockResolvedValue({ entries: [entryFor(43004001)] });

    await commentaryStore.loadForChapter(43, 4);
    // The background load is fire-and-forget; let its continuations run.
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(commentaryStore.loading).toBe(false);
    expect(commentaryStore.entries).toHaveLength(1);
  });

  it('lowers loading when the chapter fetch fails, rather than spinning forever', async () => {
    // The store logs the failure; the test asserts the recovery, not the noise.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    provider.getCommentary.mockRejectedValue(new Error('network down'));

    await commentaryStore.loadForChapter(43, 4);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(commentaryStore.loading).toBe(false);
    expect(commentaryStore.entries).toEqual([]);
    logged.mockRestore();
  });

  it('does not raise loading for the Home tab, which has its own cycle', async () => {
    commentaryStore.activeTabId = HOME_TAB_ID;
    provider.getCommentary.mockResolvedValue({ entries: [] });

    await commentaryStore.loadForChapter(43, 4);

    expect(commentaryStore.loading).toBe(false);
    // Home instead flags its own loader so it cannot flash "no data" either.
    expect(commentaryStore.homeLoading).toBe(true);
  });
});

describe('commentaryStore right-pane mode restore', () => {
  it('accepts the modes the shell can actually render', () => {
    for (const mode of ['study', 'commentary', 'topics', 'dictionary']) {
      expect(RESTORABLE_PANE_MODES.has(mode)).toBe(true);
    }
  });

  it('refuses to restore "search", which has no tab on a cold start', () => {
    // Search results are not persisted, so a restored 'search' mode left the
    // pane with no active tab and no content — the "it remembers Search but
    // nothing is visible" report.
    expect(RESTORABLE_PANE_MODES.has('search')).toBe(false);
  });

  it('refuses unknown ids, such as a pane id from a removed plugin', () => {
    expect(RESTORABLE_PANE_MODES.has('some-plugin-pane')).toBe(false);
  });
});
