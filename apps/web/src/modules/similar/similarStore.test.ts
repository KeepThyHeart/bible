import { describe, it, expect, vi, beforeEach } from 'vitest';

const table = vi.hoisted(() => ({ load: vi.fn(), reset: vi.fn() }));
vi.mock('./similarTable', () => ({ loadSimilarTable: table.load, resetSimilarTable: table.reset }));

import { similarStore } from './similarStore';
import type { WebSimilar } from './webSimilarService';

const r = (id: number) => ({ startVerseId: id, endVerseId: id });
const hit = (id: number) => ({ ...r(id), level: 'verse' as const, similarity: 0.9, isCrossReference: false, crossesTestament: false, via: 'table' as const });

function fakeWeb() {
  const findSimilar = vi.fn(async (src: { startVerseId: number }) => ({
    source: r(src.startVerseId), passages: [hit(src.startVerseId + 1000)], via: 'table' as const, approximate: false, floor: 0.5,
  }));
  const web = {
    service: { findSimilar, reset: vi.fn() },
    textOf: vi.fn(async () => 'text'),
    explain: vi.fn(async () => [{ kind: 'words' as const, words: ['love'] }]),
  } as unknown as WebSimilar;
  return { web, findSimilar };
}

const settle = () => new Promise((res) => setTimeout(res, 0));

describe('similarStore', () => {
  beforeEach(() => {
    similarStore.resetForTests();
    table.load.mockReset().mockResolvedValue({});
    table.reset.mockReset();
  });

  it('follows a verse and produces rows', async () => {
    const { web } = fakeWeb();
    similarStore.configure(web);
    similarStore.follow(r(43003016));
    await settle();
    expect(similarStore.status).toBe('ready');
    expect(similarStore.rows[0]).toMatchObject({ startVerseId: 43004016, text: 'text' });
  });

  it('is unavailable when no table is offered', async () => {
    table.load.mockResolvedValue(null);
    similarStore.configure(fakeWeb().web);
    similarStore.follow(r(43003016));
    await settle();
    expect(similarStore.status).toBe('unavailable');
  });

  it('reports an error and can retry', async () => {
    table.load.mockRejectedValueOnce(new Error('boom'));
    similarStore.configure(fakeWeb().web);
    similarStore.follow(r(43003016));
    await settle();
    expect(similarStore.status).toBe('error');
    similarStore.retry();
    await settle();
    expect(table.reset).toHaveBeenCalled();
    expect(similarStore.status).toBe('ready');
  });

  it('More like this re-centres with a back stack; following clears it', async () => {
    const { web } = fakeWeb();
    similarStore.configure(web);
    similarStore.follow(r(43003016));
    await settle();
    similarStore.moreLike(r(43004016));
    await settle();
    expect(similarStore.source).toEqual(r(43004016));
    expect(similarStore.canGoBack).toBe(true);
    similarStore.back();
    await settle();
    expect(similarStore.source).toEqual(r(43003016));
    expect(similarStore.canGoBack).toBe(false);
    similarStore.moreLike(r(43004016));
    similarStore.follow(r(1001001));
    expect(similarStore.canGoBack).toBe(false);
  });

  it('passes filters and page size to the service', async () => {
    const { web, findSimilar } = fakeWeb();
    similarStore.configure(web);
    similarStore.follow(r(43003016));
    await settle();
    similarStore.setHideKnown(true);
    similarStore.setTestament('ot');
    similarStore.showMore();
    await settle();
    expect(findSimilar).toHaveBeenLastCalledWith(r(43003016), expect.objectContaining({ crossRefs: 'hide', testament: 'ot', maxResults: 20 }));
  });

  it('fills reasons lazily', async () => {
    similarStore.configure(fakeWeb().web);
    similarStore.follow(r(43003016));
    await settle();
    await similarStore.requestReasons(similarStore.rows[0]);
    expect(similarStore.reasons.get(similarStore.rows[0].key)).toEqual([{ kind: 'words', words: ['love'] }]);
  });

  it('uses source auto, supports the other-testament filter and maps range-needs-live', async () => {
    const { web, findSimilar } = fakeWeb();
    similarStore.configure(web);
    similarStore.follow(r(43003016));
    await settle();
    expect(findSimilar).toHaveBeenLastCalledWith(r(43003016), expect.objectContaining({ source: 'auto' }));
    similarStore.setTestament('other');
    await settle();
    expect(findSimilar).toHaveBeenLastCalledWith(r(43003016), expect.objectContaining({ testament: 'other' }));
    findSimilar.mockResolvedValueOnce({ source: r(43003016), passages: [], via: 'none', reason: 'range-needs-live', approximate: false, floor: 0.5 } as never);
    similarStore.retry();
    await settle();
    expect(similarStore.status).toBe('needsLive');
  });

  it('surfaces approximate results', async () => {
    const { web, findSimilar } = fakeWeb();
    findSimilar.mockResolvedValueOnce({ source: r(43003016), passages: [hit(43004016)], via: 'table', approximate: true, floor: 0.5 } as never);
    similarStore.configure(web);
    similarStore.follow(r(43003016));
    await settle();
    expect(similarStore.approximate).toBe(true);
    expect(similarStore.status).toBe('ready');
  });
});
