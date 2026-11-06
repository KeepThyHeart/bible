/**
 * Search tabs (task 0210): the session model of `useSearchStore`.
 *
 * The active session lives in the flat store fields, every other one in
 * `parkedSessions`. A fake layout bridge stands in for dockview: it "opens a
 * panel" (returns true) and records what the store asked for, so sessions get
 * `hasPanel` and are parked rather than dropped.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SearchResult } from '@bible/core';

const performSearchMock = vi.fn();

vi.mock('../../services/electronAPI', () => ({
  searchAPI: {
    performSearch: (...args: unknown[]) => performSearchMock(...args),
    semanticSearch: vi.fn(),
    semanticAvailable: vi.fn().mockResolvedValue(false),
    getSavedSearches: vi.fn(),
    saveSearch: vi.fn(),
    loadSavedSearch: vi.fn(),
    deleteSavedSearch: vi.fn(),
    buildIndex: vi.fn(),
  },
  dictionaryAPI: {
    getAvailableDictionaries: vi.fn().mockResolvedValue([]),
    getEntryByKey: vi.fn(),
  },
  remoteSemanticAPI: {},
}));

import {
  useSearchStore,
  freshSessionFields,
  selectSessionView,
  sessionTitleQuery,
  resetSearchSessionBookkeepingForTests,
  MAX_SEARCH_TABS,
  hostedSessionIds,
  selectedHostedSessionId,
} from '../useSearchStore';
import { setShowSearchResultsPanel, setCloseSearchResultsPanel } from '../crossStoreBridge';

type ShowCall = { sessionId: string; reveal: boolean; nearSessionId: string | null };

let showCalls: ShowCall[];
let closeCalls: string[];
/** What the fake bridge answers: the panel id that shows the session (default: its own). */
let showReturn: (sessionId: string, opts: { reveal: boolean; nearSessionId: string | null }) => string | null;

const hit = (id: number): SearchResult =>
  ({ verseId: id, type: 'exact', reference: `ref ${id}`, text: `text ${id}`, matches: [], score: 1 }) as unknown as SearchResult;

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const st = () => useSearchStore.getState();
const search = (q: string, opts?: Parameters<ReturnType<typeof st>['performSearch']>[1]) =>
  st().performSearch(q, opts);

/** Make every search resolve at once with one hit whose verse id encodes the query length. */
function resolveImmediately(): void {
  performSearchMock.mockImplementation(async (q: string) => [hit(q.length)]);
}

beforeEach(() => {
  performSearchMock.mockReset();
  window.localStorage.clear();
  resetSearchSessionBookkeepingForTests();
  useSearchStore.setState({
    ...freshSessionFields(false),
    liveSuggestions: [],
    liveSearchQuery: '',
    semanticAvailable: false,
    activeSessionId: null,
    parkedSessions: {},
    sessionMeta: {},
  });
  showCalls = [];
  closeCalls = [];
  showReturn = (sessionId) => sessionId;
  setShowSearchResultsPanel((sessionId, opts) => {
    showCalls.push({ sessionId, reveal: opts.reveal, nearSessionId: opts.nearSessionId });
    return showReturn(sessionId, opts);
  });
  setCloseSearchResultsPanel((sessionId) => { closeCalls.push(sessionId); });
});

afterEach(() => {
  setShowSearchResultsPanel(null);
  setCloseSearchResultsPanel(null);
});

describe('search tabs: tab policy', () => {
  it('the first search creates an active session; results are in the flat fields and the bridge got its id', async () => {
    resolveImmediately();
    await search('love');

    const s = st();
    expect(s.activeSessionId).toBeTruthy();
    expect(s.searchResults).toHaveLength(1);
    expect(s.resultsForQuery).toBe('love');
    expect(s.isResultsVisible).toBe(true);
    expect(s.parkedSessions).toEqual({});
    expect(s.sessionMeta[s.activeSessionId!].hasPanel).toBe(true);
    expect(showCalls).toHaveLength(1);
    expect(showCalls[0]).toEqual({ sessionId: s.activeSessionId, reveal: true, nearSessionId: null });
  });

  it('Enter (no newTab) replaces the active session\'s search in the same session', async () => {
    resolveImmediately();
    await search('love');
    const id = st().activeSessionId;

    await search('faithful');

    expect(st().activeSessionId).toBe(id);
    expect(st().resultsForQuery).toBe('faithful');
    expect(st().searchResults[0].verseId).toBe('faithful'.length);
    expect(Object.keys(st().parkedSessions)).toHaveLength(0);
    expect(showCalls.map((c) => c.sessionId)).toEqual([id, id]);
  });

  it('newTab parks the previous session intact, activates a new one and hints placement near the previous', async () => {
    resolveImmediately();
    await search('love');
    const idA = st().activeSessionId!;

    await search('hope', { newTab: true });
    const idB = st().activeSessionId!;

    expect(idB).not.toBe(idA);
    expect(st().query).toBe('hope');
    expect(st().resultsForQuery).toBe('hope');
    const parkedA = st().parkedSessions[idA];
    expect(parkedA.resultsForQuery).toBe('love');
    expect(parkedA.searchResults).toHaveLength(1);
    expect(parkedA.searchResults[0].verseId).toBe('love'.length);
    expect(showCalls[1]).toEqual({ sessionId: idB, reveal: true, nearSessionId: idA });
  });

  it('activateSession swaps the flat fields with the parked tab and parks the previous one', async () => {
    resolveImmediately();
    await search('love');
    const idA = st().activeSessionId!;
    await search('hope', { newTab: true });
    const idB = st().activeSessionId!;

    st().activateSession(idA);

    expect(st().activeSessionId).toBe(idA);
    expect(st().resultsForQuery).toBe('love');
    expect(st().query).toBe('love');
    expect(st().parkedSessions[idB].resultsForQuery).toBe('hope');
    expect(st().parkedSessions[idA]).toBeUndefined();
  });

  it('an abandoned draft in the box is replaced by the tab\'s own query when it is parked', async () => {
    resolveImmediately();
    await search('love');
    const idA = st().activeSessionId!;
    st().setQuery('lov half-typed');
    await search('hope', { newTab: true });
    expect(st().parkedSessions[idA].query).toBe('love');

    const idB = st().activeSessionId!;
    st().setQuery('another draft');
    st().activateSession(idA);
    expect(st().parkedSessions[idB].query).toBe('hope');
  });

  it('activating an unknown session or the active one changes nothing else', async () => {
    resolveImmediately();
    await search('love');
    const before = st().activeSessionId;
    st().activateSession('nope');
    st().activateSession(before!);
    expect(st().activeSessionId).toBe(before);
    expect(st().resultsForQuery).toBe('love');
  });

  it('openSessionInNewTab duplicates the query into a new tab', async () => {
    resolveImmediately();
    await search('love');
    const idA = st().activeSessionId!;

    await st().openSessionInNewTab(idA);

    expect(st().activeSessionId).not.toBe(idA);
    expect(st().resultsForQuery).toBe('love');
    expect(st().isSemanticMode).toBe(false);
    expect(st().parkedSessions[idA].resultsForQuery).toBe('love');
    expect(performSearchMock).toHaveBeenCalledTimes(2);
  });

  it('openSessionInNewTab keeps the semantic flag', async () => {
    resolveImmediately();
    useSearchStore.setState({ isSemanticMode: true });
    await search('love');
    const idA = st().activeSessionId!;
    expect(st().isSemanticMode).toBe(true);

    await st().openSessionInNewTab(idA);

    expect(st().activeSessionId).not.toBe(idA);
    expect(st().isSemanticMode).toBe(true);
    expect(st().parkedSessions[idA].isSemanticMode).toBe(true);
  });

  it('openSessionInNewTab does nothing for an unknown session or an empty one', async () => {
    await st().openSessionInNewTab('ghost');
    expect(performSearchMock).not.toHaveBeenCalled();
  });

  it('setQuery keeps the results (draft model)', async () => {
    resolveImmediately();
    await search('love');
    st().setQuery('lovely');
    expect(st().query).toBe('lovely');
    expect(st().resultsForQuery).toBe('love');
    expect(st().searchResults).toHaveLength(1);
  });
});

describe('search tabs: stale replies', () => {
  it('two searches in the same tab: the later one wins even when the first resolves last', async () => {
    const d1 = deferred<SearchResult[]>();
    const d2 = deferred<SearchResult[]>();
    performSearchMock.mockReturnValueOnce(d1.promise).mockReturnValueOnce(d2.promise);

    const p1 = search('first');
    const p2 = search('second');
    d2.resolve([hit(2)]);
    await p2;
    d1.resolve([hit(1)]);
    await p1;

    expect(st().resultsForQuery).toBe('second');
    expect(st().searchResults.map((r) => r.verseId)).toEqual([2]);
    expect(st().isSearching).toBe(false);
  });

  it('a reply for tab A after switching to tab B lands in A\'s parked copy, not the flat fields', async () => {
    const dA = deferred<SearchResult[]>();
    const dB = deferred<SearchResult[]>();
    performSearchMock.mockReturnValueOnce(dA.promise).mockReturnValueOnce(dB.promise);

    const pA = search('alpha');
    const idA = st().activeSessionId!;
    const pB = search('beta', { newTab: true });
    const idB = st().activeSessionId!;
    expect(idB).not.toBe(idA);
    // A is still searching, so it is kept (parked) even without a panel yet.
    expect(st().parkedSessions[idA].isSearching).toBe(true);

    dB.resolve([hit(20)]);
    await pB;
    dA.resolve([hit(10)]);
    await pA;

    expect(st().activeSessionId).toBe(idB);
    expect(st().resultsForQuery).toBe('beta');
    expect(st().searchResults.map((r) => r.verseId)).toEqual([20]);
    const parkedA = st().parkedSessions[idA];
    expect(parkedA.resultsForQuery).toBe('alpha');
    expect(parkedA.searchResults.map((r) => r.verseId)).toEqual([10]);
    expect(parkedA.isSearching).toBe(false);
    // A got its panel when its results arrived, in the background.
    expect(showCalls.find((c) => c.sessionId === idA)?.reveal).toBe(false);
  });

  it('results arriving for a closed session are dropped', async () => {
    const d = deferred<SearchResult[]>();
    performSearchMock.mockReturnValueOnce(d.promise);
    const p = search('gone');
    const id = st().activeSessionId!;

    st().closeSession(id);
    d.resolve([hit(5)]);
    await p;

    expect(st().activeSessionId).toBeNull();
    expect(st().searchResults).toEqual([]);
    expect(showCalls).toHaveLength(0);
  });

  it('results arriving for a closed parked session are dropped', async () => {
    const dA = deferred<SearchResult[]>();
    performSearchMock.mockReturnValueOnce(dA.promise).mockResolvedValueOnce([hit(2)]);
    const pA = search('alpha');
    const idA = st().activeSessionId!;
    await search('beta', { newTab: true });

    st().closeSession(idA);
    dA.resolve([hit(1)]);
    await pA;

    expect(st().parkedSessions[idA]).toBeUndefined();
    expect(st().sessionMeta[idA]).toBeUndefined();
    expect(st().resultsForQuery).toBe('beta');
  });
});

describe('search tabs: closing and the cap', () => {
  async function openThree() {
    resolveImmediately();
    await search('aa');
    const a = st().activeSessionId!;
    await search('bbb', { newTab: true });
    const b = st().activeSessionId!;
    await search('cccc', { newTab: true });
    const c = st().activeSessionId!;
    return { a, b, c };
  }

  it('closing the active tab activates the most recently used remaining tab', async () => {
    const { a, b, c } = await openThree();
    st().activateSession(a);
    st().activateSession(c);
    // Recency now: c, a, b.

    st().closeSession(c);

    expect(st().activeSessionId).toBe(a);
    expect(st().resultsForQuery).toBe('aa');
    expect(st().searchResults).toHaveLength(1);
    expect(st().parkedSessions[b]).toBeDefined();
    expect(st().parkedSessions[a]).toBeUndefined();
    expect(st().sessionMeta[c]).toBeUndefined();
  });

  it('closing a parked tab leaves the active one alone', async () => {
    const { a, b, c } = await openThree();
    st().closeSession(a);
    expect(st().activeSessionId).toBe(c);
    expect(Object.keys(st().parkedSessions)).toEqual([b]);
  });

  it('closing the last tab keeps the query text and empties the results', async () => {
    resolveImmediately();
    await search('love');
    const id = st().activeSessionId!;

    st().closeSession(id);

    expect(st().activeSessionId).toBeNull();
    expect(st().query).toBe('love');
    expect(st().searchResults).toEqual([]);
    expect(st().resultsForQuery).toBe('');
    expect(st().isResultsVisible).toBe(false);
    expect(st().sessionMeta[id]).toBeUndefined();
  });

  it('opening a 9th tab closes the least recently used one, and a recently activated old tab survives', async () => {
    resolveImmediately();
    const ids: string[] = [];
    for (let i = 0; i < MAX_SEARCH_TABS; i++) {
      await search(`query${'x'.repeat(i)}`, { newTab: true });
      ids.push(st().activeSessionId!);
    }
    expect(new Set(ids).size).toBe(MAX_SEARCH_TABS);
    expect(Object.keys(st().parkedSessions)).toHaveLength(MAX_SEARCH_TABS - 1);
    expect(closeCalls).toEqual([]);

    // Use the oldest tab again: the second-oldest becomes the least recently used.
    st().activateSession(ids[0]);
    await search('ninth tab', { newTab: true });
    const ninth = st().activeSessionId!;

    expect(closeCalls).toEqual([ids[1]]);
    const all = [st().activeSessionId!, ...Object.keys(st().parkedSessions)];
    expect(all).toHaveLength(MAX_SEARCH_TABS);
    expect(all).toContain(ninth);
    expect(all).toContain(ids[0]);
    expect(all).not.toContain(ids[1]);
    expect(st().sessionMeta[ids[1]]).toBeUndefined();
  });
});

describe('search tabs: restoring tabs from a saved layout', () => {
  it('restoreSessions creates parked sessions with pendingRerun; empty queries are skipped', () => {
    st().restoreSessions([
      { id: 'r1', query: '  faith ' },
      { id: 'r2', query: 'grace', semantic: true },
      { id: 'r3', query: '   ' },
    ]);

    const s = st();
    expect(Object.keys(s.parkedSessions).sort()).toEqual(['r1', 'r2']);
    expect(s.parkedSessions.r1.pendingRerun).toBe(true);
    expect(s.parkedSessions.r1.query).toBe('faith');
    expect(s.parkedSessions.r1.isSemanticMode).toBe(false);
    expect(s.parkedSessions.r2.isSemanticMode).toBe(true);
    expect(s.sessionMeta.r1.hasPanel).toBe(true);
    expect(s.activeSessionId).toBeNull();
    // The tab is titled with the query while the re-run is pending.
    expect(sessionTitleQuery(s.parkedSessions.r1)).toBe('faith');
    expect(performSearchMock).not.toHaveBeenCalled();
  });

  it('restoring an id that already exists is a no-op for that id', async () => {
    resolveImmediately();
    await search('love');
    const id = st().activeSessionId!;
    st().restoreSessions([{ id, query: 'other' }]);
    expect(st().parkedSessions[id]).toBeUndefined();
    expect(st().resultsForQuery).toBe('love');
  });

  it('runPendingRerun runs in that session with reveal:false and activates it when none is active', async () => {
    resolveImmediately();
    st().restoreSessions([{ id: 'r1', query: 'faith' }]);

    await st().runPendingRerun('r1');

    expect(performSearchMock).toHaveBeenCalledTimes(1);
    expect(performSearchMock.mock.calls[0][0]).toBe('faith');
    expect(st().activeSessionId).toBe('r1');
    expect(st().resultsForQuery).toBe('faith');
    expect(st().pendingRerun).toBe(false);
    expect(showCalls).toEqual([{ sessionId: 'r1', reveal: false, nearSessionId: null }]);
  });

  it('runPendingRerun does not steal the active session; the results land in the parked copy', async () => {
    resolveImmediately();
    await search('love');
    const active = st().activeSessionId!;
    st().restoreSessions([{ id: 'r2', query: 'grace' }]);

    await st().runPendingRerun('r2');

    expect(st().activeSessionId).toBe(active);
    expect(st().resultsForQuery).toBe('love');
    expect(st().parkedSessions.r2.resultsForQuery).toBe('grace');
    expect(st().parkedSessions.r2.pendingRerun).toBe(false);
    expect(showCalls[showCalls.length - 1]).toEqual({ sessionId: 'r2', reveal: false, nearSessionId: null });
  });

  it('runPendingRerun twice only searches once', async () => {
    resolveImmediately();
    st().restoreSessions([{ id: 'r1', query: 'faith' }]);
    await st().runPendingRerun('r1');
    await st().runPendingRerun('r1');
    expect(performSearchMock).toHaveBeenCalledTimes(1);
  });
});

describe('search tabs: selectSessionView', () => {
  it('returns the flat state for the active id, the parked copy for others, a stable empty view for unknown ids', async () => {
    resolveImmediately();
    await search('love');
    const idA = st().activeSessionId!;
    await search('hope', { newTab: true });
    const idB = st().activeSessionId!;
    const s = st();

    expect(selectSessionView(s, idB)).toBe(s);
    expect(selectSessionView(s)).toBe(s);
    expect(selectSessionView(s, idA)).toBe(s.parkedSessions[idA]);
    expect(selectSessionView(s, idA).resultsForQuery).toBe('love');

    const unknown1 = selectSessionView(s, 'missing');
    const unknown2 = selectSessionView(s, 'other-missing');
    expect(unknown1).not.toBe(s);
    expect(unknown1).toBe(unknown2);
    expect(unknown1.searchResults).toEqual([]);
    expect(unknown1.resultsForQuery).toBe('');
  });

  it('with no sessions at all an unknown id shows the flat state (pre-tabs behaviour)', () => {
    expect(selectSessionView(st(), 'whatever')).toBe(st());
  });
});

describe('search tabs: without a layout bridge', () => {
  it('a panel-less, non-searching session is dropped when a new tab starts', async () => {
    setShowSearchResultsPanel(null);
    resolveImmediately();
    await search('love');
    const idA = st().activeSessionId!;
    expect(st().sessionMeta[idA].hasPanel).toBe(false);

    await search('hope', { newTab: true });

    expect(st().parkedSessions[idA]).toBeUndefined();
    expect(st().sessionMeta[idA]).toBeUndefined();
  });
});

describe('search tabs: manual-test fixes', () => {
  it('retries a keyword search the main process rejects as busy ("Search already in progress")', async () => {
    let calls = 0;
    performSearchMock.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) throw new Error('Search already in progress');
      return [hit(1)];
    });
    await search('love');
    expect(calls).toBe(2);
    expect(st().error).toBeNull();
    expect(st().resultsForQuery).toBe('love');
  });

  it('does not retry any other error', async () => {
    performSearchMock.mockRejectedValue(new Error('Search failed: boom'));
    await search('love');
    expect(performSearchMock).toHaveBeenCalledTimes(1);
    expect(st().error).toBe('boom');
  });

  it('a tab whose search failed is still titled with its query', async () => {
    performSearchMock.mockRejectedValue(new Error('Search failed: boom'));
    await search('love');
    expect(sessionTitleQuery(selectSessionView(st(), st().activeSessionId))).toBe('love');
  });
});

describe('search tabs: sessions hosted in a right-pane host panel', () => {
  const HOST = 'host_panel';
  /** Bridge that puts every session into the host, as showSessionPanel does for "Tab in the right pane". */
  const hostEverything = () => { showReturn = () => HOST; };

  it('a session revealed into a host gets hostPanelId and hasPanel', async () => {
    hostEverything();
    resolveImmediately();
    await search('love');

    const id = st().activeSessionId!;
    expect(st().sessionMeta[id]).toMatchObject({ hasPanel: true, hostPanelId: HOST });
    expect(hostedSessionIds(st(), HOST)).toEqual([id]);
  });

  it('a session that shows in its own panel has no hostPanelId', async () => {
    resolveImmediately();
    await search('love');
    const id = st().activeSessionId!;
    expect(st().sessionMeta[id].hostPanelId ?? null).toBeNull();
  });

  it('newTab from a hosted session passes it as nearSessionId, and the new session joins the same host', async () => {
    hostEverything();
    resolveImmediately();
    await search('love');
    const a = st().activeSessionId!;

    await search('hope', { newTab: true });
    const b = st().activeSessionId!;

    expect(showCalls[showCalls.length - 1]).toMatchObject({ sessionId: b, nearSessionId: a });
    expect(hostedSessionIds(st(), HOST)).toEqual([a, b]);
    expect(selectedHostedSessionId(st(), HOST)).toBe(b);
  });

  it('hosted sessions keep their opening order, whatever the recency', async () => {
    hostEverything();
    resolveImmediately();
    await search('aa');
    const a = st().activeSessionId!;
    await search('bbb', { newTab: true });
    const b = st().activeSessionId!;
    await search('cccc', { newTab: true });
    const c = st().activeSessionId!;
    st().activateSession(a);

    expect(hostedSessionIds(st(), HOST)).toEqual([a, b, c]);
    expect(selectedHostedSessionId(st(), HOST)).toBe(a);
  });

  it('the cap applies across hosted sessions: the least recently used goes, the others keep their order', async () => {
    hostEverything();
    resolveImmediately();
    const ids: string[] = [];
    for (let i = 0; i < MAX_SEARCH_TABS; i++) {
      await search(`query${'x'.repeat(i)}`, { newTab: true });
      ids.push(st().activeSessionId!);
    }
    st().activateSession(ids[0]);

    await search('ninth tab', { newTab: true });
    const ninth = st().activeSessionId!;

    expect(closeCalls).toEqual([ids[1]]);
    expect(hostedSessionIds(st(), HOST)).toEqual([...ids.filter((x) => x !== ids[1]), ninth]);
  });

  it('closeSession on a sub-tab removes only that session; the active one falls back to the most recent', async () => {
    hostEverything();
    resolveImmediately();
    await search('aa');
    const a = st().activeSessionId!;
    await search('bbb', { newTab: true });
    const b = st().activeSessionId!;

    st().closeSession(b);

    expect(st().activeSessionId).toBe(a);
    expect(hostedSessionIds(st(), HOST)).toEqual([a]);
  });

  it('closePanelSessions drops every session of the host and leaves other sessions alone', async () => {
    resolveImmediately();
    await search('own');
    const own = st().activeSessionId!;
    hostEverything();
    await search('aa', { newTab: true });
    const a = st().activeSessionId!;
    await search('bbb', { newTab: true });
    const b = st().activeSessionId!;

    st().closePanelSessions(HOST);

    expect(st().sessionMeta[a]).toBeUndefined();
    expect(st().sessionMeta[b]).toBeUndefined();
    expect(hostedSessionIds(st(), HOST)).toEqual([]);
    expect(st().activeSessionId).toBe(own);
    expect(st().parkedSessions[a]).toBeUndefined();
    expect(st().parkedSessions[b]).toBeUndefined();
  });

  it('closePanelSessions with a plain panel id closes that one session', async () => {
    resolveImmediately();
    await search('aa');
    const a = st().activeSessionId!;
    await search('bbb', { newTab: true });
    const b = st().activeSessionId!;

    st().closePanelSessions(a);

    expect(st().sessionMeta[a]).toBeUndefined();
    expect(st().activeSessionId).toBe(b);
  });

  it('closePanelSessions closing the last hosted session empties the search', async () => {
    hostEverything();
    resolveImmediately();
    await search('aa');
    st().closePanelSessions(HOST);
    expect(st().activeSessionId).toBeNull();
    expect(st().resultsForQuery).toBe('');
  });

  it('restoreSessions with hostPanelId keeps sessions in the host, and recent marks the selected one', () => {
    st().restoreSessions([
      { id: 'r1', query: 'one', hostPanelId: HOST },
      { id: 'r2', query: 'two', hostPanelId: HOST, recent: true },
      { id: 'r3', query: 'three', hostPanelId: HOST },
    ]);

    expect(hostedSessionIds(st(), HOST)).toEqual(['r1', 'r2', 'r3']);
    expect(selectedHostedSessionId(st(), HOST)).toBe('r2');
    expect(st().sessionMeta.r1).toMatchObject({ hasPanel: true, hostPanelId: HOST });
    expect(st().parkedSessions.r2).toMatchObject({ query: 'two', pendingRerun: true });
  });

  it('restoreSessions without hostPanelId leaves hostPanelId null', () => {
    st().restoreSessions([{ id: 'r1', query: 'one' }]);
    expect(st().sessionMeta.r1.hostPanelId ?? null).toBeNull();
    expect(hostedSessionIds(st(), HOST)).toEqual([]);
  });

  it('selectedHostedSessionId is null for an empty host and prefers the active session', () => {
    expect(selectedHostedSessionId(st(), HOST)).toBeNull();
    st().restoreSessions([{ id: 'r1', query: 'one', hostPanelId: HOST, recent: true }, { id: 'r2', query: 'two', hostPanelId: HOST }]);
    useSearchStore.setState({ activeSessionId: 'r2' });
    expect(selectedHostedSessionId(st(), HOST)).toBe('r2');
  });
});
