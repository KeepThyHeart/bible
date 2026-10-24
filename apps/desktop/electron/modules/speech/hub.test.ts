import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ISpeechApi } from '@bible/core/speech';
import { getMainSpeech, notifySpeechWindowGone, scopedSpeech, setMainSpeech } from './hub';

afterEach(() => setMainSpeech(null));

function fake() {
  let n = 0;
  const api = {
    status: vi.fn(async () => ({ granted: { listen: true, speak: true }, listen: 'ready', speak: 'ready', languages: [], engineLabel: 'x', onDevice: true })),
    speak: vi.fn(async () => ({ completed: true })),
    earcon: vi.fn(async () => undefined),
    startListening: vi.fn(async () => ({ listenId: `l${++n}` })),
    nextUtterance: vi.fn(async () => ({ kind: 'no-speech' as const })),
    stopListening: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
  };
  return api as unknown as ISpeechApi & typeof api;
}

describe('speech hub', () => {
  it('is empty until a service is set', () => {
    expect(getMainSpeech()).toBeNull();
    expect(scopedSpeech('a')).toBeNull();
  });

  it('cancel stops only the caller\'s own listens', async () => {
    const main = fake();
    setMainSpeech(main);
    const a = scopedSpeech('a')!;
    const b = scopedSpeech('b')!;
    const la = (await a.startListening({ language: 'en', maxDurationMs: 1 })).listenId;
    const lb = (await b.startListening({ language: 'en', maxDurationMs: 1 })).listenId;
    await a.cancel();
    expect(main.stopListening).toHaveBeenCalledTimes(1);
    expect(main.stopListening).toHaveBeenCalledWith(la);
    expect(main.cancel).not.toHaveBeenCalled();
    expect(await b.nextUtterance(lb, { noSpeechTimeoutMs: 1 })).toEqual({ kind: 'no-speech' });
  });

  it('refuses foreign listen ids', async () => {
    const main = fake();
    setMainSpeech(main);
    const a = scopedSpeech('a')!;
    const b = scopedSpeech('b')!;
    const la = (await a.startListening({ language: 'en', maxDurationMs: 1 })).listenId;
    await expect(b.nextUtterance(la, { noSpeechTimeoutMs: 1 })).rejects.toThrow(/Unknown/);
    await b.stopListening(la);
    expect(main.stopListening).not.toHaveBeenCalled();
  });

  it('cancels in-flight speech only when nobody else is active', async () => {
    const main = fake();
    let release!: () => void;
    main.speak.mockImplementation(() => new Promise((r) => (release = () => r({ completed: true }))));
    setMainSpeech(main);
    const a = scopedSpeech('a')!;
    const b = scopedSpeech('b')!;
    const speaking = a.speak('hi');
    await b.startListening({ language: 'en', maxDurationMs: 1 });
    await a.cancel();
    expect(main.cancel).not.toHaveBeenCalled();
    await b.cancel();
    await a.cancel();
    expect(main.cancel).toHaveBeenCalledTimes(1);
    release();
    await speaking;
  });

  it('forgets listens when an utterance ends the session; window gone fires the callback', async () => {
    const main = fake();
    const gone = vi.fn();
    setMainSpeech(main, gone);
    const a = scopedSpeech('a')!;
    const id = (await a.startListening({ language: 'en', maxDurationMs: 1 })).listenId;
    main.nextUtterance.mockResolvedValueOnce({ kind: 'ended', reason: 'stopped' } as never);
    await a.nextUtterance(id, { noSpeechTimeoutMs: 1 });
    await expect(a.nextUtterance(id, { noSpeechTimeoutMs: 1 })).rejects.toThrow();
    notifySpeechWindowGone();
    expect(gone).toHaveBeenCalled();
  });
});
