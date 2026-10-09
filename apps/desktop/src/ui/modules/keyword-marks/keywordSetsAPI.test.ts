import { describe, it, expect, vi } from 'vitest';
import { IpcKeywordSetStore } from './keywordSetsAPI';
import type { KeywordSet } from '@bible/core/browser';

const set = { schema: 1, id: 's', name: 'S', scope: { kind: 'everywhere' }, marks: [], updatedAt: 'x' } as KeywordSet;

describe('IpcKeywordSetStore', () => {
  it('lists, puts and removes through the keyword-marks module client', async () => {
    const bridge = { list: vi.fn(async () => [set]), put: vi.fn(async () => undefined), remove: vi.fn(async () => undefined) };
    const store = new IpcKeywordSetStore(() => bridge as never);
    expect(await store.list()).toEqual([set]);
    await store.put(set);
    await store.remove('s');
    expect(bridge.put).toHaveBeenCalledWith(set);
    expect(bridge.remove).toHaveBeenCalledWith('s');
  });

  it('rejects when the handler reports an error', async () => {
    const bridge = { put: vi.fn(async () => { throw new Error('bad'); }) };
    await expect(new IpcKeywordSetStore(() => bridge as never).put(set)).rejects.toThrow('bad');
  });

  it('uses the module:keyword-marks:* channels', async () => {
    const invoke = vi.fn(async () => ({ ok: true as const, value: [] }));
    const { createModuleClient } = await import('../../services/moduleClient');
    const client = createModuleClient<import('../../../../electron/modules/keyword-marks/types').KeywordMarksApi>('keyword-marks', () => ({ invoke: invoke as never, on: vi.fn() }));
    await client.list();
    expect(invoke).toHaveBeenCalledWith('keyword-marks', 'list');
  });
});
