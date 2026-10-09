import { FakeListener, FakeSpeaker, type ScriptItem } from '@bible/core/speech';
import type { ISttEngine } from '@bible/core/speech';
import { SpeechService } from './SpeechService';

const engine = (o: { ready?: boolean; supported?: boolean } = {}) => {
  const prepared: string[] = [];
  const e = {
    capabilities: { languages: ['en'] },
    isSupported: async () => o.supported ?? true,
    isModelReady: async () => o.ready ?? true,
    prepare: async (id: string) => void prepared.push(id),
    listModels: async () => [{ id: 'base', label: 'B', languages: ['en'], downloadBytes: 1, quality: 'medium' }],
  } as unknown as ISttEngine;
  return { e, prepared };
};

class GatedSpeaker extends FakeSpeaker {
  gate: Promise<void> | null = null;
  inFlight = 0;
  async speak(...a: Parameters<FakeSpeaker['speak']>) {
    this.inFlight++;
    try {
      await this.gate;
      if (!a[2].aborted) await super.speak(...a);
    } finally {
      this.inFlight--;
    }
  }
  available = async () => true;
}

function make(script: ScriptItem[] = [], o: { ready?: boolean; supported?: boolean } = {}) {
  const { e, prepared } = engine(o);
  const listener = new FakeListener(script);
  const speaker = new GatedSpeaker();
  const svc = new SpeechService({
    engine: e,
    listener,
    speaker,
    chooseModel: async () => 'base',
    tailMs: 5,
    idleRetryMs: 5,
  });
  return { svc, listener, speaker, prepared };
}
const dto = { language: 'en-US', maxDurationMs: 60_000 };
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

describe('SpeechService', () => {
  it('reports status', async () => {
    const { svc } = make();
    expect(await svc.status()).toMatchObject({ listen: 'ready', speak: 'ready', engineLabel: 'Whisper (base)', onDevice: true });
    expect((await make([], { ready: false }).svc.status()).listen).toBe('needs-download');
    expect((await make([], { supported: false }).svc.status()).listen).toBe('unavailable');
  });

  it('queues utterances from startListening on', async () => {
    const { svc, prepared } = make([{ say: 'one two' }, { say: 'three' }]);
    const { listenId } = await svc.startListening(dto);
    expect(prepared).toEqual(['base']);
    await tick();
    const a = await svc.nextUtterance(listenId, { noSpeechTimeoutMs: 1000 });
    const b = await svc.nextUtterance(listenId, { noSpeechTimeoutMs: 1000 });
    expect(a).toMatchObject({ kind: 'speech', transcript: { text: 'one two' } });
    expect(b).toMatchObject({ kind: 'speech', transcript: { text: 'three' } });
    await svc.stopListening(listenId);
  });

  it('times out with no-speech', async () => {
    const { svc } = make([]);
    const { listenId } = await svc.startListening(dto);
    expect(await svc.nextUtterance(listenId, { noSpeechTimeoutMs: 20 })).toEqual({ kind: 'no-speech' });
    await svc.stopListening(listenId);
  });

  it('holds the no-speech timer while the listener is capturing an utterance', async () => {
    const { svc, listener } = make();
    const slow = listener as unknown as { capturing: boolean; listen: FakeListener['listen'] };
    let n = 0;
    slow.listen = async () => {
      if (n++ > 0) return { kind: 'aborted' };
      slow.capturing = true;
      await tick(120);
      slow.capturing = false;
      return { kind: 'speech', transcript: { text: 'late words', words: [{ text: 'late' }, { text: 'words' }], final: true, engineId: 'f', modelId: 'm', audioMs: 1, decodeMs: 1 } };
    };
    const { listenId } = await svc.startListening(dto);
    const out = await svc.nextUtterance(listenId, { noSpeechTimeoutMs: 30 });
    expect(out.kind).toBe('speech');
  });

  it('allows one listen at a time and rejects when the model is missing', async () => {
    const { svc } = make();
    const { listenId } = await svc.startListening(dto);
    await expect(svc.startListening(dto)).rejects.toThrow('busy');
    await svc.stopListening(listenId);
    await expect(svc.startListening(dto)).resolves.toBeTruthy();
    await svc.cancel();
    await expect(make([], { ready: false }).svc.startListening(dto)).rejects.toThrow('not-ready');
  });

  it('stopListening resolves waiters as stopped and is idempotent; unknown ids end', async () => {
    const { svc } = make();
    const { listenId } = await svc.startListening(dto);
    const p = svc.nextUtterance(listenId, { noSpeechTimeoutMs: 5000 });
    await svc.stopListening(listenId);
    expect(await p).toEqual({ kind: 'ended', reason: 'stopped' });
    await svc.stopListening(listenId);
    expect(await svc.nextUtterance(listenId, { noSpeechTimeoutMs: 10 })).toEqual({ kind: 'ended', reason: 'stopped' });
    expect(await svc.nextUtterance('nope', { noSpeechTimeoutMs: 10 })).toEqual({ kind: 'ended', reason: 'stopped' });
  });

  it('cancel aborts pending utterances and speech', async () => {
    const { svc, speaker } = make();
    const { listenId } = await svc.startListening(dto);
    const p = svc.nextUtterance(listenId, { noSpeechTimeoutMs: 5000 });
    let release!: () => void;
    speaker.gate = new Promise((r) => (release = r));
    const s = svc.speak('hello');
    await svc.cancel();
    expect(await p).toEqual({ kind: 'ended', reason: 'aborted' });
    release();
    expect(await s).toEqual({ completed: false });
    expect(speaker.spoken).toEqual([]);
    expect(await svc.nextUtterance(listenId, { noSpeechTimeoutMs: 10 })).toEqual({ kind: 'ended', reason: 'stopped' });
  });

  it('speaks with language and rate, plays earcons', async () => {
    const { svc, speaker } = make();
    expect(await svc.speak('Hi', { language: 'es', rate: 1.2 })).toEqual({ completed: true });
    await svc.earcon('ok');
    expect(speaker.spoken).toEqual([{ text: 'Hi', language: 'es', rate: 1.2 }]);
    expect(speaker.earcons).toEqual(['ok']);
  });

  it('is half duplex: the listen is aborted while speaking and restarted after', async () => {
    const { svc, speaker, listener } = make([{ say: 'echo', duringSpeak: true }, { say: 'real' }]);
    let release!: () => void;
    speaker.gate = new Promise((r) => (release = r));
    const { listenId } = await svc.startListening(dto);
    const s = svc.speak('prompt');
    await tick();
    const calls = listener.calls.length;
    await tick(30);
    expect(listener.calls.length).toBe(calls); // no listening while speaking
    release();
    await s;
    const u = await svc.nextUtterance(listenId, { noSpeechTimeoutMs: 1000 });
    expect(u).toMatchObject({ kind: 'speech', transcript: { text: expect.stringMatching(/^(real|echo)$/) } });
    await svc.stopListening(listenId);
  });

  it('drops an utterance that finished while sound played', async () => {
    const { svc, speaker } = make([{ say: 'echo' }]);
    let release!: () => void;
    speaker.gate = new Promise((r) => (release = r));
    const s = svc.speak('prompt'); // before listening starts
    const { listenId } = await svc.startListening(dto);
    await tick(30);
    expect(await svc.nextUtterance(listenId, { noSpeechTimeoutMs: 20 })).toEqual({ kind: 'no-speech' });
    release();
    await s;
    expect(await svc.nextUtterance(listenId, { noSpeechTimeoutMs: 1000 })).toMatchObject({ kind: 'speech' });
    await svc.cancel();
  });

  it('reports mic errors then ends the session', async () => {
    const { svc } = make([{ error: 'mic-denied' }]);
    const { listenId } = await svc.startListening(dto);
    expect(await svc.nextUtterance(listenId, { noSpeechTimeoutMs: 1000 })).toMatchObject({ kind: 'error', code: 'mic-denied' });
    expect(await svc.nextUtterance(listenId, { noSpeechTimeoutMs: 1000 })).toEqual({ kind: 'ended', reason: 'stopped' });
    await svc.stopListening(listenId);
    await expect(svc.startListening(dto)).resolves.toBeTruthy();
    await svc.cancel();
  });

  it('ends at maxDurationMs', async () => {
    const { svc } = make();
    const { listenId } = await svc.startListening({ ...dto, maxDurationMs: 30 });
    expect(await svc.nextUtterance(listenId, { noSpeechTimeoutMs: 2000 })).toEqual({ kind: 'ended', reason: 'max-duration' });
    await svc.stopListening(listenId);
  });

  it('lists models with install state and removes via the dep', async () => {
    const { svc } = make();
    expect(await svc.models()).toMatchObject([{ id: 'base', installed: true, chosen: true }]);
    expect(await svc.chosen()).toBe('base');
    await svc.prepareModel('base', () => undefined, new AbortController().signal);
    await svc.removeModel('base');
  });
});
