import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const find = vi.fn();
const explain = vi.fn();
vi.mock('../services/electronAPI', () => ({
  similarAPI: { find: (...a: unknown[]) => find(...a), explain: (...a: unknown[]) => explain(...a) },
}));
const openSimilarPanel = vi.fn();
vi.mock('./useLayoutStore', () => ({
  useLayoutStore: { getState: () => ({ openSimilarPanel }) },
}));

import { useSimilarStore, SIMILAR_MAX_POLLS, SIMILAR_POLL_MS } from './useSimilarStore';

const r = (v: number) => ({ startVerseId: v, endVerseId: v });
const okResp = (n = 1) => ({ status: 'ok', result: { source: r(1), passages: [], rows: Array.from({ length: n }, (_, i) => ({ key: `k${i}` })), via: 'table', approximate: false, floor: 0.5 } });
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
const state = (id = 'p1') => useSimilarStore.getState().getPanelState(id);

describe('useSimilarStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    find.mockReset();
    explain.mockReset();
    openSimilarPanel.mockReset().mockReturnValue('p1');
    for (const id of [...useSimilarStore.getState().panels.keys()]) useSimilarStore.getState().destroyPanel(id);
    useSimilarStore.setState({ explanations: new Map() });
  });
  afterEach(() => vi.useRealTimers());

  it('openFor opens the panel, sets the source and loads', async () => {
    find.mockResolvedValue(okResp());
    useSimilarStore.getState().openFor(r(100));
    expect(state().source).toEqual(r(100));
    expect(state().status).toBe('loading');
    await flush();
    expect(state().status).toBe('ready');
    expect(find.mock.calls[0][1]).toMatchObject({ maxResults: 20, crossRefs: 'flag', testament: 'any' });
  });

  it('followVerse moves linked panels and ignores unlinked ones', async () => {
    find.mockResolvedValue(okResp());
    const s = useSimilarStore.getState();
    s.initPanel('a');
    s.initPanel('b');
    s.setLinked('b', false);
    s.followVerse(5);
    await flush();
    expect(state('a').source).toEqual(r(5));
    expect(state('b').source).toBeNull();
    expect(find).toHaveBeenCalledTimes(1);
  });

  it('moreLike pushes the source on the back stack and goBack restores it', async () => {
    find.mockResolvedValue(okResp());
    useSimilarStore.getState().openFor(r(1));
    useSimilarStore.getState().moreLike('p1', r(2));
    expect(state().source).toEqual(r(2));
    expect(state().history).toEqual([r(1)]);
    useSimilarStore.getState().goBack('p1');
    expect(state().source).toEqual(r(1));
    expect(state().history).toEqual([]);
  });

  it('filters map to find options; showMore raises maxResults up to 50', async () => {
    find.mockResolvedValue(okResp());
    useSimilarStore.getState().openFor(r(1));
    useSimilarStore.getState().setFilters('p1', { hideKnownXrefs: true, testament: 'ot' });
    expect(find.mock.calls.at(-1)![1]).toMatchObject({ crossRefs: 'hide', testament: 'ot', maxResults: 20 });
    for (let i = 0; i < 5; i++) useSimilarStore.getState().showMore('p1');
    expect(state().maxResults).toBe(50);
    expect(find.mock.calls.at(-1)![1]).toMatchObject({ maxResults: 50 });
  });

  it('polls while preparing, then shows the result', async () => {
    find.mockResolvedValueOnce({ status: 'preparing' }).mockResolvedValue(okResp());
    useSimilarStore.getState().openFor(r(1));
    await flush();
    expect(state().status).toBe('preparing');
    await vi.advanceTimersByTimeAsync(SIMILAR_POLL_MS);
    await flush();
    expect(state().status).toBe('ready');
    expect(find).toHaveBeenCalledTimes(2);
  });

  it('gives up after the maximum number of polls', async () => {
    find.mockResolvedValue({ status: 'preparing' });
    useSimilarStore.getState().openFor(r(1));
    for (let i = 0; i < SIMILAR_MAX_POLLS + 2; i++) {
      await vi.advanceTimersByTimeAsync(SIMILAR_POLL_MS);
    }
    expect(state().status).toBe('error');
    expect(state().error).toBe('timeout');
    expect(find).toHaveBeenCalledTimes(SIMILAR_MAX_POLLS + 1);
  });

  it('destroyPanel stops polling', async () => {
    find.mockResolvedValue({ status: 'preparing' });
    useSimilarStore.getState().openFor(r(1));
    await flush();
    useSimilarStore.getState().destroyPanel('p1');
    await vi.advanceTimersByTimeAsync(SIMILAR_POLL_MS * 5);
    expect(find).toHaveBeenCalledTimes(1);
  });

  it('records unavailable and error states', async () => {
    find.mockResolvedValueOnce({ status: 'unavailable', unavailableReason: 'no-table-no-pack' });
    useSimilarStore.getState().openFor(r(1));
    await flush();
    expect(state()).toMatchObject({ status: 'unavailable', unavailableReason: 'no-table-no-pack' });
    find.mockRejectedValueOnce(new Error('boom'));
    useSimilarStore.getState().retry('p1');
    await flush();
    expect(state()).toMatchObject({ status: 'error', error: 'boom' });
  });

  it('clears explanations when a source changes', async () => {
    find.mockResolvedValue(okResp());
    explain.mockResolvedValue([{ kind: 'word', label: 'love' }]);
    useSimilarStore.getState().openFor(r(1));
    useSimilarStore.getState().requestExplanation('p1', r(9));
    await flush();
    expect(useSimilarStore.getState().explanations.size).toBe(1);
    useSimilarStore.getState().moreLike('p1', r(2));
    expect(useSimilarStore.getState().explanations.size).toBe(0);
  });

  it('caches explanations and fetches each pair once', async () => {
    find.mockResolvedValue(okResp());
    explain.mockResolvedValue([{ kind: 'word', label: 'love' }]);
    useSimilarStore.getState().openFor(r(1));
    useSimilarStore.getState().requestExplanation('p1', r(9));
    useSimilarStore.getState().requestExplanation('p1', r(9));
    await flush();
    useSimilarStore.getState().requestExplanation('p1', r(9));
    expect(explain).toHaveBeenCalledTimes(1);
    expect(useSimilarStore.getState().explanations.size).toBe(1);
  });
});
