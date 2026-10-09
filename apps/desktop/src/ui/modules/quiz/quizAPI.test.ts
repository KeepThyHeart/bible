import { describe, it, expect, vi } from 'vitest';
import { IpcQuizSource, IpcQuizProgressStore } from './quizAPI';

const ok = <T,>(value: T) => Promise.resolve(value);

function bridge(overrides: Record<string, unknown> = {}) {
  return {
    getCatalog: vi.fn(() => ok({ modules: [], coverage: [] })),
    getQuestions: vi.fn(() => ok([])),
    getStats: vi.fn(() => ok({})),
    recordAttempt: vi.fn(() => ok(undefined)),
    recordSession: vi.fn(() => ok(undefined)),
    listSessions: vi.fn(() => ok([])),
    ...overrides,
  } as never;
}

describe('IpcQuizSource', () => {
  it('passes passages and filter through and unwraps the reply', async () => {
    const b = bridge({ getQuestions: vi.fn(() => ok([{ key: 'a' }])) });
    const source = new IpcQuizSource(() => b);
    const passages = [{ start: 1, end: 2 }];
    await expect(source.getQuestions(passages, { kinds: ['recall'] })).resolves.toEqual([{ key: 'a' }]);
    expect((b as any).getQuestions).toHaveBeenCalledWith(passages, { kinds: ['recall'] });
    await expect(source.getCatalog()).resolves.toEqual({ modules: [], coverage: [] });
  });

  it('throws when the main process answers an error', async () => {
    const b = bridge({ getCatalog: vi.fn(() => Promise.reject(new Error('boom'))) });
    await expect(new IpcQuizSource(() => b).getCatalog()).rejects.toThrow('boom');
  });
});

describe('IpcQuizProgressStore', () => {
  it('turns the stats object into a Map, and skips the call for no keys', async () => {
    const stat = { key: 'k', seen: 1, correct: 1, partly: 0, missed: 0 };
    const b = bridge({ getStats: vi.fn(() => ok({ k: stat })) });
    const store = new IpcQuizProgressStore(() => b);
    const map = await store.getStats(['k']);
    expect(map).toBeInstanceOf(Map);
    expect(map.get('k')).toEqual(stat);
    expect((await store.getStats([])).size).toBe(0);
    expect((b as any).getStats).toHaveBeenCalledTimes(1);
  });

  it('records attempts and sessions and lists sessions', async () => {
    const b = bridge({ listSessions: vi.fn(() => ok([{ id: 's' }])) });
    const store = new IpcQuizProgressStore(() => b);
    await store.recordAttempt({ key: 'k', result: 'correct', at: 'now' });
    await store.recordSession({ id: 's' } as never);
    expect((b as any).recordAttempt).toHaveBeenCalledWith({ key: 'k', result: 'correct', at: 'now' });
    expect((b as any).recordSession).toHaveBeenCalledWith({ id: 's' });
    await expect(store.listSessions(5)).resolves.toEqual([{ id: 's' }]);
    expect((b as any).listSessions).toHaveBeenCalledWith(5);
  });
});
