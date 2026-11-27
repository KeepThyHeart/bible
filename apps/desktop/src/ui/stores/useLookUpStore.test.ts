import { describe, it, expect, vi, beforeEach } from 'vitest';

const answers = vi.hoisted(() => ({ resolvers: [] as Array<(v: unknown) => void> }));
vi.mock('../services/electronAPI', () => ({
  dictionaryAPI: { lookUp: vi.fn(() => new Promise(resolve => { answers.resolvers.push(resolve); })) },
}));

import { useLookUpStore } from './useLookUpStore';

const group = (sourceId: string) => [{ providerId: 'dictionary', sourceId, sourceName: sourceId, entries: [{ key: 'k', title: 't' }] }];

describe('useLookUpStore', () => {
  beforeEach(() => {
    answers.resolvers.length = 0;
    useLookUpStore.getState().clear();
  });

  it('runs the query through the registry and keeps the groups with hits', async () => {
    const run = useLookUpStore.getState().run({ text: '  “walked,” ' });
    expect(useLookUpStore.getState().loading).toBe(true);
    expect(useLookUpStore.getState().query?.text).toBe('walked');
    answers.resolvers[0](group('Easton'));
    await run;
    expect(useLookUpStore.getState().groups.map(g => g.sourceId)).toEqual(['Easton']);
    expect(useLookUpStore.getState().loading).toBe(false);
  });

  it('a slow earlier answer cannot overwrite a newer look-up', async () => {
    const first = useLookUpStore.getState().run({ text: 'love' });
    const second = useLookUpStore.getState().run({ text: 'grace' });
    answers.resolvers[1](group('Newer'));
    await second;
    answers.resolvers[0](group('Older'));
    await first;
    expect(useLookUpStore.getState().groups.map(g => g.sourceId)).toEqual(['Newer']);
    expect(useLookUpStore.getState().query?.text).toBe('grace');
  });

  it('ignores empty text and clears', async () => {
    await useLookUpStore.getState().run({ text: '  ' });
    expect(useLookUpStore.getState().query).toBeNull();
  });
});
