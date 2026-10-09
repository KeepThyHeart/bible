import { describe, expect, it } from 'vitest';
import type {
  IMicrophone,
  ISttEngine,
  IVoiceActivityDetector,
  ListenOptions,
  MicStream,
  Transcript,
} from '@bible/core/speech';
import { PcmListener } from './PcmListener';

const FRAME = 320;
const frame = (v: number): Float32Array => new Float32Array(FRAME).fill(v);
/** 'S' = speech frame, '.' = silence frame. */
const SP = 1;
const SI = 0;

class Clock {
  t = 0;
  timers: { at: number; fn: () => void; live: boolean }[] = [];
  now = (): number => this.t;
  setTimer = (fn: () => void, ms: number): (() => void) => {
    const e = { at: this.t + ms, fn, live: true };
    this.timers.push(e);
    return () => {
      e.live = false;
    };
  };
  advance(ms: number): void {
    this.t += ms;
    for (const e of this.timers) if (e.live && e.at <= this.t) { e.live = false; e.fn(); }
  }
}

class FakeMic implements IMicrophone {
  closed = 0;
  opened = 0;
  cb?: (f: Float32Array) => void;
  constructor(private readonly err?: unknown) {}
  async open(): Promise<MicStream> {
    this.opened++;
    if (this.err) throw this.err;
    return {
      onFrame: (cb) => {
        this.cb = cb;
        return () => { this.cb = undefined; };
      },
      close: () => { this.closed++; },
    };
  }
}

const vad = (): IVoiceActivityDetector => ({ reset() {}, process: (f) => (f[0] > 0 ? 'speech' : 'silence') });

class FakeEngine {
  calls: { samples: number }[] = [];
  text = 'hello world';
  fail = false;
  hold?: { resolve: () => void; p: Promise<void> };
  ready = true;
  capabilities = { wordTimestamps: false, wordConfidence: false, biasing: 'prompt', needsDownload: true, languages: ['en'] };
  isModelReady = async (): Promise<boolean> => this.ready;
  async transcribe(pcm: Float32Array, _r: unknown, signal: AbortSignal): Promise<Transcript> {
    this.calls.push({ samples: pcm.length });
    if (this.hold) await this.hold.p;
    if (signal.aborted) throw new Error('aborted');
    if (this.fail) throw new Error('boom');
    return { text: this.text, words: [], final: true, engineId: 'e', modelId: 'm', audioMs: 0, decodeMs: 0 };
  }
}

const opts = (o: Partial<ListenOptions> = {}): ListenOptions => ({
  language: 'en',
  noSpeechTimeoutMs: 8000,
  endSilenceMs: 1500,
  maxDurationMs: 30000,
  ...o,
});

function setup(micErr?: unknown) {
  const clock = new Clock();
  const mic = new FakeMic(micErr);
  const engine = new FakeEngine();
  const listener = new PcmListener({
    mic,
    vad,
    engine: engine as unknown as ISttEngine,
    modelId: () => 'm',
    now: clock.now,
    setTimer: clock.setTimer,
  });
  /** Push frames, advancing the clock 20 ms each. */
  const feed = (pattern: string): void => {
    for (const c of pattern) {
      clock.advance(20);
      mic.cb?.(frame(c === 'S' ? SP : SI));
    }
  };
  const tick = async (): Promise<void> => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
  return { clock, mic, engine, listener, feed, tick };
}

describe('PcmListener', () => {
  it('reports no-speech after the timeout and closes the mic', async () => {
    const { clock, mic, listener, tick, feed } = setup();
    const p = listener.listen(opts(), new AbortController().signal);
    await tick();
    feed('.'.repeat(10));
    clock.advance(8000);
    expect(await p).toEqual({ kind: 'no-speech' });
    expect(mic.closed).toBeGreaterThan(0);
  });

  it('ends after endSilenceMs and returns the transcript', async () => {
    const { mic, engine, listener, feed, tick } = setup();
    const p = listener.listen(opts(), new AbortController().signal);
    await tick();
    feed('.'.repeat(30) + 'S'.repeat(25) + '.'.repeat(74));
    expect(mic.cb).toBeDefined();
    feed('.');
    const r = await p;
    expect(r.kind).toBe('speech');
    if (r.kind === 'speech') expect(r.transcript.final).toBe(true);
    // 15 pre-roll + 25 speech + 10 trailing-silence frames
    expect(engine.calls.at(-1)!.samples).toBe((15 + 25 + 10) * FRAME);
    expect(mic.cb).toBeUndefined();
    expect(mic.closed).toBeGreaterThan(0);
  });

  it('isComplete shortens the end silence to 700 ms', async () => {
    const { clock, engine, listener, feed, tick } = setup();
    const partials: string[] = [];
    const p = listener.listen(
      opts({ onPartial: (t) => partials.push(t.text), isComplete: () => true }),
      new AbortController().signal,
    );
    await tick();
    feed('S'.repeat(80)); // 1.6 s of speech: a partial fires at 1.5 s
    await tick();
    expect(partials).toEqual(['hello world']);
    feed('.'.repeat(34));
    clock.advance(0);
    feed('.');
    const r = await p;
    expect(r.kind).toBe('speech');
    expect(engine.calls.length).toBe(2);
  });

  it('stops at maxDurationMs and transcribes what was heard', async () => {
    const { clock, listener, feed, tick } = setup();
    const p = listener.listen(opts({ maxDurationMs: 3000 }), new AbortController().signal);
    await tick();
    feed('S'.repeat(40));
    clock.advance(3000);
    const r = await p;
    expect(r.kind).toBe('speech');
  });

  it('throttles partials to 1.5 s and drops them while the engine is busy', async () => {
    const { listener, engine, feed, tick } = setup();
    let release!: () => void;
    engine.hold = { resolve: () => release(), p: new Promise<void>((r) => { release = r; }) };
    const seen: string[] = [];
    const ac = new AbortController();
    const p = listener.listen(opts({ onPartial: (t) => seen.push(t.text) }), ac.signal);
    await tick();
    feed('S'.repeat(60)); // 1.2 s: none yet
    expect(engine.calls.length).toBe(0);
    feed('S'.repeat(20)); // 1.5 s: one partial
    expect(engine.calls.length).toBe(1);
    feed('S'.repeat(100)); // busy: dropped
    expect(engine.calls.length).toBe(1);
    release();
    await tick();
    expect(seen).toEqual(['hello world']);
    feed('S'.repeat(80)); // idle again, 1.5 s later: next partial
    expect(engine.calls.length).toBe(2);
    ac.abort();
    expect(await p).toEqual({ kind: 'aborted' });
  });

  it('abort returns aborted and closes the mic', async () => {
    const { mic, listener, feed, tick } = setup();
    const ac = new AbortController();
    const p = listener.listen(opts(), ac.signal);
    await tick();
    feed('SSSS');
    ac.abort();
    expect(await p).toEqual({ kind: 'aborted' });
    expect(mic.closed).toBeGreaterThan(0);
  });

  it('an already-aborted signal never opens the mic', async () => {
    const { mic, listener } = setup();
    const ac = new AbortController();
    ac.abort();
    expect(await listener.listen(opts(), ac.signal)).toEqual({ kind: 'aborted' });
    expect(mic.opened).toBe(0);
  });

  it.each([
    [{ name: 'NotAllowedError' }, 'mic-denied'],
    [{ code: 'mic-denied' }, 'mic-denied'],
    [{ code: 'mic-busy' }, 'mic-busy'],
    [new Error('x'), 'mic-busy'],
  ])('maps mic error %j to %s', async (err, code) => {
    const { listener } = setup(err);
    const r = await listener.listen(opts(), new AbortController().signal);
    expect(r.kind).toBe('error');
    if (r.kind === 'error') expect(r.code).toBe(code);
  });

  it('reports engine failure as an engine error and closes the mic', async () => {
    const { mic, engine, listener, feed, tick } = setup();
    engine.fail = true;
    const p = listener.listen(opts({ endSilenceMs: 200 }), new AbortController().signal);
    await tick();
    feed('S'.repeat(20) + '.'.repeat(10));
    const r = await p;
    expect(r).toMatchObject({ kind: 'error', code: 'engine' });
    expect(mic.closed).toBeGreaterThan(0);
  });

  it('reports not-ready when the model is missing', async () => {
    const { engine, mic, listener } = setup();
    engine.ready = false;
    const r = await listener.listen(opts(), new AbortController().signal);
    expect(r).toMatchObject({ kind: 'error', code: 'engine', message: 'not-ready' });
    expect(mic.opened).toBe(0);
  });

  it('turns an empty transcript into no-speech', async () => {
    const { engine, listener, feed, tick } = setup();
    engine.text = '  ';
    const p = listener.listen(opts({ endSilenceMs: 200 }), new AbortController().signal);
    await tick();
    feed('S'.repeat(20) + '.'.repeat(10));
    expect(await p).toEqual({ kind: 'no-speech' });
  });

  it('treats a speech blip under 250 ms as no-speech without decoding', async () => {
    const { engine, listener, feed, tick } = setup();
    const p = listener.listen(opts({ endSilenceMs: 200 }), new AbortController().signal);
    await tick();
    feed('SSS' + '.'.repeat(10));
    expect(await p).toEqual({ kind: 'no-speech' });
    expect(engine.calls.length).toBe(0);
  });
});
