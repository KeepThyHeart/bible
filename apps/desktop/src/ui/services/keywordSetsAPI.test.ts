import { describe, it, expect, vi } from 'vitest';
import { IpcKeywordSetStore } from './keywordSetsAPI';
import type { KeywordSet } from '@bible/core/browser';

const set = { schema: 1, id: 's', name: 'S', scope: { kind: 'everywhere' }, marks: [], updatedAt: 'x' } as KeywordSet;

describe('IpcKeywordSetStore', () => {
  it('unwraps list and sends put/remove over the keyword channels', async () => {
    const invoke = vi.fn(async (channel: string) => ({ ok: true as const, value: channel === 'keywords:list' ? [set] : undefined }));
    const store = new IpcKeywordSetStore(invoke);
    expect(await store.list()).toEqual([set]);
    await store.put(set);
    await store.remove('s');
    expect(invoke.mock.calls).toEqual([['keywords:list'], ['keywords:put', set], ['keywords:remove', 's']]);
  });

  it('throws when the handler reports an error', async () => {
    const invoke = vi.fn(async () => ({ ok: false as const, error: { code: 'invalid_input' as const, message: 'bad' } }));
    await expect(new IpcKeywordSetStore(invoke).put(set)).rejects.toThrow('bad');
  });
});
