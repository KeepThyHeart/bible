import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TimelineDataProvider } from './TimelineDataProvider';

const dataset = { info: { name: 'T' }, chronologies: [], lanes: [], items: [] };

function reply(status: number, body: unknown = {}) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as Response);
}

describe('TimelineDataProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('fetches /api/timeline once and caches the dataset in memory', async () => {
    fetchMock.mockReturnValue(reply(200, dataset));
    const p = new TimelineDataProvider('http://x');
    expect(await p.getDataset()).toEqual(dataset);
    expect(await p.getDataset()).toEqual(dataset);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('http://x/api/timeline');
  });

  it('resolves null on 404 and asks again next time', async () => {
    fetchMock.mockReturnValueOnce(reply(404)).mockReturnValueOnce(reply(200, dataset));
    const p = new TimelineDataProvider('');
    expect(await p.getDataset()).toBeNull();
    expect(await p.getDataset()).toEqual(dataset);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects on a server error and does not cache the failure', async () => {
    fetchMock.mockReturnValueOnce(reply(500)).mockReturnValueOnce(reply(200, dataset));
    const p = new TimelineDataProvider('');
    await expect(p.getDataset()).rejects.toThrow('500');
    expect(await p.getDataset()).toEqual(dataset);
  });
});
