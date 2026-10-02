import { describe, expect, it } from 'vitest';

import {
  FakeListener,
  FakeSpeaker,
  FakeSpeechApi,
  createListenerRegistry,
  createSttEngineRegistry,
  words,
} from '../../speech';

describe('words', () => {
  it('splits on whitespace', () => {
    expect(words('  For God  so loved ').map((w) => w.text)).toEqual(['For', 'God', 'so', 'loved']);
    expect(words('')).toEqual([]);
  });
});

describe('registries', () => {
  it('register, get, list, unregister', () => {
    const reg = createListenerRegistry();
    const l = new FakeListener();
    const off = reg.register(l);
    expect(reg.get('fake')).toBe(l);
    expect(reg.list()).toHaveLength(1);
    off();
    expect(reg.get('fake')).toBeUndefined();
    expect(createSttEngineRegistry().list()).toEqual([]);
  });
});

describe('FakeListener', () => {
  it('plays its script then reports no-speech', async () => {
    const l = new FakeListener([{ say: 'in the beginning' }, { silence: true }, { error: 'mic-denied' }]);
    const o = { language: 'en-US', noSpeechTimeoutMs: 1, endSilenceMs: 1, maxDurationMs: 1 };
    const sig = new AbortController().signal;
    const a = await l.listen(o, sig);
    expect(a.kind === 'speech' && a.transcript.text).toBe('in the beginning');
    expect((await l.listen(o, sig)).kind).toBe('no-speech');
    expect(await l.listen(o, sig)).toMatchObject({ kind: 'error', code: 'mic-denied' });
    expect((await l.listen(o, sig)).kind).toBe('no-speech');
    const ac = new AbortController();
    ac.abort();
    expect((await l.listen(o, ac.signal)).kind).toBe('aborted');
  });
});

describe('FakeSpeaker', () => {
  it('records calls', async () => {
    const s = new FakeSpeaker();
    await s.speak('hi', { language: 'en-US', rate: 1.1 }, new AbortController().signal);
    await s.earcon('ok');
    expect(s.spoken).toEqual([{ text: 'hi', language: 'en-US', rate: 1.1 }]);
    expect(s.earcons).toEqual(['ok']);
  });
});

describe('FakeSpeechApi', () => {
  const start = { language: 'en-US', maxDurationMs: 1000 };

  it('serves scripted utterances in order', async () => {
    const api = new FakeSpeechApi({
      script: [{ say: 'for god' }, { silence: true }, { error: 'engine' }, { say: words('so loved') }],
    });
    const { listenId } = await api.startListening(start);
    const pull = () => api.nextUtterance(listenId, { noSpeechTimeoutMs: 100 });
    const a = await pull();
    expect(a.kind === 'speech' && a.transcript.words.map((w) => w.text)).toEqual(['for', 'god']);
    expect((await pull()).kind).toBe('no-speech');
    expect(await pull()).toMatchObject({ kind: 'error', code: 'engine' });
    expect((await pull()).kind).toBe('speech');
    expect((await pull()).kind).toBe('no-speech');
  });

  it('records speech and earcons, and status reflects options', async () => {
    const api = new FakeSpeechApi({ granted: { listen: true, speak: false }, status: { speak: 'unavailable' } });
    await api.speak('Genesis 1:1', { language: 'en-US' });
    await api.earcon('done');
    expect(api.spoken).toEqual([{ text: 'Genesis 1:1', language: 'en-US' }]);
    expect(api.earcons).toEqual(['done']);
    expect(await api.status()).toMatchObject({ granted: { listen: true, speak: false }, speak: 'unavailable', listen: 'ready' });
  });

  it('drops a duringSpeak utterance pulled while speaking (half duplex)', async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const api = new FakeSpeechApi({
      script: [{ say: 'leaked echo', duringSpeak: true }, { say: 'real answer' }],
      gate: (m) => (m === 'speak' ? held : undefined),
    });
    const { listenId } = await api.startListening(start);
    const speaking = api.speak('prompt');
    const out = await api.nextUtterance(listenId, { noSpeechTimeoutMs: 100 });
    expect(out.kind === 'speech' && out.transcript.text).toBe('real answer');
    release();
    await speaking;
    // When not speaking, a duringSpeak item is delivered normally.
    const api2 = new FakeSpeechApi({ script: [{ say: 'ok', duringSpeak: true }] });
    const l2 = await api2.startListening(start);
    expect((await api2.nextUtterance(l2.listenId, { noSpeechTimeoutMs: 1 })).kind).toBe('speech');
  });

  it('ends after stopListening and after cancel', async () => {
    const api = new FakeSpeechApi({ script: [{ say: 'x' }] });
    const a = await api.startListening(start);
    await api.stopListening(a.listenId);
    await api.stopListening(a.listenId); // idempotent
    expect(await api.nextUtterance(a.listenId, { noSpeechTimeoutMs: 1 })).toEqual({ kind: 'ended', reason: 'stopped' });
    const b = await api.startListening(start);
    await api.cancel();
    expect(await api.nextUtterance(b.listenId, { noSpeechTimeoutMs: 1 })).toEqual({ kind: 'ended', reason: 'stopped' });
  });

  it('gate() holds a call pending until released', async () => {
    let release!: () => void;
    const api = new FakeSpeechApi({
      script: [{ say: 'late' }],
      gate: (m) => (m === 'nextUtterance' ? new Promise<void>((r) => (release = r)) : undefined),
    });
    const { listenId } = await api.startListening(start);
    let settled = false;
    const p = api.nextUtterance(listenId, { noSpeechTimeoutMs: 1 }).then((o) => {
      settled = true;
      return o;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    expect((await p).kind).toBe('speech');
  });

  it('a stop that lands while a pull is held resolves the pull as ended', async () => {
    let release!: () => void;
    const api = new FakeSpeechApi({
      script: [{ say: 'late' }],
      gate: (m) => (m === 'nextUtterance' ? new Promise<void>((r) => (release = r)) : undefined),
    });
    const { listenId } = await api.startListening(start);
    const p = api.nextUtterance(listenId, { noSpeechTimeoutMs: 1 });
    await api.cancel();
    release();
    expect(await p).toEqual({ kind: 'ended', reason: 'stopped' });
  });
});
