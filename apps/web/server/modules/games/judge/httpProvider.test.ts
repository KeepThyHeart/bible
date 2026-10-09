import { describe, it, expect, afterEach, vi } from 'vitest';
import { createHttpJudge } from './httpProvider.js';
import type { JudgeFetch, JudgeHttpRequest, JudgeHttpResponse } from './httpProvider.js';
import type { JudgeRequest } from '../../../../src/modules/games/shared/protocol.js';

const REQUEST: JudgeRequest = {
  question: 'Which prophet was taken up by a whirlwind into heaven?',
  canonicalAnswer: 'Elijah',
  accept: ['Elias', 'the prophet Elijah'],
  contextNote: 'Elias is the New Testament spelling and counts.',
  seenPrefix: 'Which prophet was taken',
  playerAnswer: 'Elias',
};

const SETTINGS = {
  baseUrl: 'https://api.example.test/v1',
  apiKey: 'key-abc',
  model: 'a-model',
  timeoutMs: 1_000,
};

/** A reply body in the shape every chat-completions host returns. */
function completion(content: string): JudgeHttpResponse {
  return { ok: true, status: 200, json: () => Promise.resolve({ choices: [{ message: { content } }] }) };
}

function replyingWith(response: JudgeHttpResponse): { fetch: JudgeFetch; seen: () => Sent | null } {
  let sent: Sent | null = null;
  return {
    fetch: (url, init) => {
      sent = { url, init };
      return Promise.resolve(response);
    },
    seen: () => sent,
  };
}

interface Sent {
  url: string;
  init: JudgeHttpRequest;
}

/** Never settles on its own; the only way out is the provider's own abort. */
const hanging: JudgeFetch = (_url, init) =>
  new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('the request was aborted')));
  });

afterEach(() => {
  vi.useRealTimers();
});

describe('the HTTP judge, when the host answers', () => {
  it('turns a well-formed reply into a suggestion', async () => {
    const host = replyingWith(completion('{"verdict":"correct","reason":"Elias is the same prophet."}'));
    const judge = createHttpJudge({ ...SETTINGS, fetch: host.fetch });

    expect(await judge.suggest(REQUEST)).toEqual({
      verdict: 'correct',
      reason: 'Elias is the same prophet.',
    });
  });

  it('posts to the chat-completions endpoint with the key and the model', async () => {
    const host = replyingWith(completion('{"verdict":"incorrect","reason":"Different prophet."}'));
    const judge = createHttpJudge({ ...SETTINGS, fetch: host.fetch });
    await judge.suggest(REQUEST);

    const sent = host.seen();
    expect(sent?.url).toBe('https://api.example.test/v1/chat/completions');
    expect(sent?.init.method).toBe('POST');
    expect(sent?.init.headers.authorization).toBe('Bearer key-abc');
    expect(JSON.parse(sent?.init.body ?? '{}')).toMatchObject({ model: 'a-model', temperature: 0 });
  });

  it('does not double the slash when the base url has a trailing one', async () => {
    const host = replyingWith(completion('{"verdict":"correct","reason":"y"}'));
    const judge = createHttpJudge({ ...SETTINGS, baseUrl: 'https://api.example.test/v1/', fetch: host.fetch });
    await judge.suggest(REQUEST);

    expect(host.seen()?.url).toBe('https://api.example.test/v1/chat/completions');
  });

  it('gives the model the author lists, the prefix read and the answer said', async () => {
    const host = replyingWith(completion('{"verdict":"correct","reason":"y"}'));
    const judge = createHttpJudge({ ...SETTINGS, fetch: host.fetch });
    await judge.suggest(REQUEST);

    const prompt = host.seen()?.init.body ?? '';
    expect(prompt).toContain('Which prophet was taken up by a whirlwind into heaven?');
    expect(prompt).toContain('Elijah');
    expect(prompt).toContain('the prophet Elijah');
    expect(prompt).toContain('Elias is the New Testament spelling and counts.');
    expect(prompt).toContain('Which prophet was taken');
    expect(prompt).toContain('The player said: Elias');
  });

  it('leaves out an absent context note and an empty accept list', async () => {
    const host = replyingWith(completion('{"verdict":"correct","reason":"y"}'));
    const judge = createHttpJudge({ ...SETTINGS, fetch: host.fetch });
    await judge.suggest({ ...REQUEST, accept: [], contextNote: null, seenPrefix: '' });

    const prompt = host.seen()?.init.body ?? '';
    expect(prompt).not.toContain('Also accepted');
    expect(prompt).not.toContain("Note from the question's author");
    expect(prompt).not.toContain('buzzed having read only');
  });

  it('reads a verdict a model wrapped in chatter or a code fence', async () => {
    const host = replyingWith(
      completion('Here is my ruling:\n```json\n{"verdict":"ambiguous","reason":"Too vague."}\n```')
    );
    const judge = createHttpJudge({ ...SETTINGS, fetch: host.fetch });

    expect(await judge.suggest(REQUEST)).toEqual({ verdict: 'ambiguous', reason: 'Too vague.' });
  });

  it('accepts a capitalised verdict and collapses the reason', async () => {
    const host = replyingWith(completion('{"verdict":"Correct","reason":"  same\\n  prophet  "}'));
    const judge = createHttpJudge({ ...SETTINGS, fetch: host.fetch });

    expect(await judge.suggest(REQUEST)).toEqual({ verdict: 'correct', reason: 'same prophet' });
  });

  it('clips a reason that would fill the projector', async () => {
    const host = replyingWith(completion(`{"verdict":"correct","reason":"${'word '.repeat(80).trim()}"}`));
    const judge = createHttpJudge({ ...SETTINGS, fetch: host.fetch });

    const suggestion = await judge.suggest(REQUEST);
    expect(suggestion?.verdict).toBe('correct');
    expect((suggestion?.reason ?? '').length).toBeLessThanOrEqual(160);
  });

  it('keeps a verdict whose reason is missing', async () => {
    // The verdict is the useful half; a host can act on it with no explanation.
    const host = replyingWith(completion('{"verdict":"incorrect"}'));
    const judge = createHttpJudge({ ...SETTINGS, fetch: host.fetch });

    expect(await judge.suggest(REQUEST)).toEqual({ verdict: 'incorrect', reason: '' });
  });
});

describe('the HTTP judge, when something goes wrong', () => {
  it('stays quiet on a non-200', async () => {
    const host = replyingWith({ ok: false, status: 401, json: () => Promise.resolve({}) });
    const judge = createHttpJudge({ ...SETTINGS, fetch: host.fetch });

    expect(await judge.suggest(REQUEST)).toBeNull();
  });

  it('stays quiet when the connection fails outright', async () => {
    const judge = createHttpJudge({
      ...SETTINGS,
      fetch: () => Promise.reject(new Error('ECONNREFUSED')),
    });

    expect(await judge.suggest(REQUEST)).toBeNull();
  });

  it('stays quiet when the body is not JSON at all', async () => {
    const judge = createHttpJudge({
      ...SETTINGS,
      fetch: () =>
        Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new SyntaxError('unexpected <')) }),
    });

    expect(await judge.suggest(REQUEST)).toBeNull();
  });

  it('stays quiet when the model returned prose instead of the object', async () => {
    const host = replyingWith(completion('I think that answer is probably fine, honestly.'));
    const judge = createHttpJudge({ ...SETTINGS, fetch: host.fetch });

    expect(await judge.suggest(REQUEST)).toBeNull();
  });

  it('stays quiet when the object it returned is malformed', async () => {
    const host = replyingWith(completion('{"verdict": "correct", "reason": '));
    const judge = createHttpJudge({ ...SETTINGS, fetch: host.fetch });

    expect(await judge.suggest(REQUEST)).toBeNull();
  });

  it('stays quiet on a verdict word nobody asked for', async () => {
    // A verdict the host screen has no button for would be worse than silence.
    const host = replyingWith(completion('{"verdict":"maybe","reason":"could go either way"}'));
    const judge = createHttpJudge({ ...SETTINGS, fetch: host.fetch });

    expect(await judge.suggest(REQUEST)).toBeNull();
  });

  it('stays quiet on a body with no choices in it', async () => {
    const judge = createHttpJudge({
      ...SETTINGS,
      fetch: () =>
        Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ error: 'over quota' }) }),
    });

    expect(await judge.suggest(REQUEST)).toBeNull();
  });
});

describe('the HTTP judge, when the host is slow', () => {
  it('gives up at the timeout and cancels the request', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | null = null;
    const judge = createHttpJudge({
      ...SETTINGS,
      timeoutMs: 1_000,
      fetch: (url, init) => {
        signal = init.signal;
        return hanging(url, init);
      },
    });

    const pending = judge.suggest(REQUEST);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(await pending).toBeNull();
    // Cancelled, not merely abandoned: a reply that arrives after the host has
    // tapped is worthless and the socket should not outlive the round.
    expect((signal as AbortSignal | null)?.aborted).toBe(true);
  });

  it('is still waiting a millisecond before the deadline', async () => {
    vi.useFakeTimers();
    let settled = false;
    const judge = createHttpJudge({ ...SETTINGS, timeoutMs: 1_000, fetch: hanging });

    const pending = judge.suggest(REQUEST).then((result) => {
      settled = true;
      return result;
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toBeNull();
  });

  it('drops its timer once the host has answered', async () => {
    // Otherwise a fast reply still pins the event loop open for the remainder
    // of the timeout, which shows up as a process that will not exit.
    vi.useFakeTimers();
    const host = replyingWith(completion('{"verdict":"correct","reason":"y"}'));
    const judge = createHttpJudge({ ...SETTINGS, timeoutMs: 60_000, fetch: host.fetch });

    await judge.suggest(REQUEST);
    expect(vi.getTimerCount()).toBe(0);
  });
});
