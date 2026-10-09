import { describe, it, expect, vi, beforeEach } from 'vitest';

const created = vi.hoisted(() => vi.fn());
vi.mock('../judge/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../judge/index.js')>();
  return {
    ...actual,
    createJudgeProvider: (...args: Parameters<typeof actual.createJudgeProvider>) => {
      const judge = actual.createJudgeProvider(...args);
      created(args[1], judge.id);
      return judge;
    },
  };
});

import { config } from '../config.js';
import { createGamesRouter } from './index.js';

describe('games router privacy wiring', () => {
  const original = config.judge;
  beforeEach(() => {
    created.mockReset();
    config.judge = { baseUrl: 'https://api.example.test/v1', apiKey: 'key', model: 'm' } as typeof config.judge;
    return () => {
      config.judge = original;
    };
  });

  it('strict, or unspecified, uses the local judge even with a key configured', () => {
    createGamesRouter({ privacyMode: 'strict' });
    createGamesRouter();
    expect(created).toHaveBeenNthCalledWith(1, { privacyMode: 'strict' }, 'local');
    expect(created).toHaveBeenNthCalledWith(2, { privacyMode: undefined }, 'local');
  });

  it('relaxed with a key uses the HTTP judge', () => {
    createGamesRouter({ privacyMode: 'relaxed' });
    expect(created.mock.calls[0]?.[1]).toBe('chat-completions');
  });
});
