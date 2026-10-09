import { describe, it, expect, afterEach, vi } from 'vitest';
import { createJudgeProvider, HTTP_JUDGE_ID, DEFAULT_TIMEOUT_MS } from './index.js';
import type { JudgeFetch } from './index.js';
import type { JudgeRequest } from '../../../../src/modules/games/shared/protocol.js';

const REQUEST: JudgeRequest = {
  question: 'Who wrote the majority of the Psalms?',
  canonicalAnswer: 'David',
  accept: ['King David'],
  contextNote: null,
  seenPrefix: 'Who wrote',
  playerAnswer: 'king david',
};

const COMPLETE = {
  baseUrl: 'https://api.example.test/v1',
  apiKey: 'key-abc',
  model: 'a-model',
};

/** Fails the test if it is ever reached: a null provider must not call out. */
const forbidden: JudgeFetch = () => {
  throw new Error('the null provider must not make a request');
};

function answering(content: string): JudgeFetch {
  return () =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ choices: [{ message: { content } }] }) });
}

const originalTimeout = process.env.BIBLE_GAMES_JUDGE_TIMEOUT_MS;

afterEach(() => {
  vi.useRealTimers();
  if (originalTimeout === undefined) delete process.env.BIBLE_GAMES_JUDGE_TIMEOUT_MS;
  else process.env.BIBLE_GAMES_JUDGE_TIMEOUT_MS = originalTimeout;
});

describe('choosing a provider', () => {
  it('gives the null provider when judging is not configured', async () => {
    const judge = createJudgeProvider(null);
    expect(judge.id).toBe('none');
    expect(await judge.suggest(REQUEST)).toBeNull();
  });

  it('gives the null provider when the key is missing', async () => {
    // The common half-configured case: a base url and a model in the
    // environment file, and the key still sitting in someone's password vault.
    const judge = createJudgeProvider({ ...COMPLETE, apiKey: '', fetch: forbidden });
    expect(judge.id).toBe('none');
    expect(await judge.suggest(REQUEST)).toBeNull();
  });

  it('gives the null provider when the base url or the model is blank', () => {
    expect(createJudgeProvider({ ...COMPLETE, baseUrl: '   ', fetch: forbidden }).id).toBe('none');
    expect(createJudgeProvider({ ...COMPLETE, model: '', fetch: forbidden }).id).toBe('none');
  });

  it('gives the HTTP provider when everything is present', async () => {
    const judge = createJudgeProvider({
      ...COMPLETE,
      fetch: answering('{"verdict":"correct","reason":"Same person."}'),
    });

    expect(judge.id).toBe(HTTP_JUDGE_ID);
    expect(await judge.suggest(REQUEST)).toEqual({ verdict: 'correct', reason: 'Same person.' });
  });

  it('trims a base url and a model pasted in with whitespace', async () => {
    let url: string | null = null;
    const judge = createJudgeProvider({
      ...COMPLETE,
      baseUrl: ' https://api.example.test/v1 ',
      model: ' a-model ',
      fetch: (seen, init) => {
        url = seen;
        return answering('{"verdict":"correct","reason":"y"}')(seen, init);
      },
    });
    await judge.suggest(REQUEST);

    expect(url).toBe('https://api.example.test/v1/chat/completions');
  });
});

describe('the timeout the room is willing to wait', () => {
  it('comes from the environment when one is set', async () => {
    process.env.BIBLE_GAMES_JUDGE_TIMEOUT_MS = '250';
    vi.useFakeTimers();
    const judge = createJudgeProvider({
      ...COMPLETE,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    });

    const pending = judge.suggest(REQUEST);
    await vi.advanceTimersByTimeAsync(250);
    expect(await pending).toBeNull();
  });

  it('falls back to the default when the environment value is nonsense', async () => {
    // A mistyped timeout should cost nothing: the provider is otherwise fully
    // configured, and refusing to judge over a typo is the wrong trade.
    process.env.BIBLE_GAMES_JUDGE_TIMEOUT_MS = 'soon';
    vi.useFakeTimers();
    const judge = createJudgeProvider({
      ...COMPLETE,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    });

    let settled = false;
    const pending = judge.suggest(REQUEST).then((result) => {
      settled = true;
      return result;
    });
    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS - 1);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toBeNull();
  });

  it('takes an explicit setting over the environment', async () => {
    process.env.BIBLE_GAMES_JUDGE_TIMEOUT_MS = '90000';
    vi.useFakeTimers();
    const judge = createJudgeProvider({
      ...COMPLETE,
      timeoutMs: 100,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    });

    const pending = judge.suggest(REQUEST);
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toBeNull();
  });
});
